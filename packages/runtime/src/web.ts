import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { load } from "cheerio";
import type { AgentTool, JsonObject, ToolResult } from "./contracts.js";
import type { ToolRegistry } from "./tools.js";

const defaultSearchEndpoint = "https://html.duckduckgo.com/html/";
const blockedHostnames = new Set(["localhost", "localhost.localdomain"]);

export interface WebToolOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly resolveHost?: (hostname: string) => Promise<readonly string[]>;
  readonly searchEndpoint?: string;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly maxRedirects?: number;
}

function stringInput(input: JsonObject, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`'${key}' must be a non-empty string`);
  return value.trim();
}

function positiveInteger(input: JsonObject, key: string, fallback: number, maximum: number): number {
  const value = input[key];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`'${key}' must be a positive number`);
  }
  return Math.min(maximum, Math.floor(value));
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [first, second] = parts;
  return first === 0
    || first === 10
    || first === 127
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 192 && second === 0)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19 || (second === 51 && parts[2] === 100)))
    || (first === 203 && second === 0 && parts[2] === 113)
    || first >= 224;
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0];
  if (isIP(normalized) === 4) return isPrivateIpv4(normalized);
  if (isIP(normalized) !== 6) return true;
  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (normalized.startsWith("::ffff:")) return mapped ? isPrivateIpv4(mapped) : true;
  if (normalized.startsWith("2001:db8:")) return true;
  return !/^[23]/.test(normalized);
}

async function defaultResolveHost(hostname: string): Promise<readonly string[]> {
  return (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);
}

async function validatePublicUrl(value: string, resolveHost: NonNullable<WebToolOptions["resolveHost"]>): Promise<URL> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("URL must be a valid absolute HTTP or HTTPS URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only HTTP and HTTPS URLs are allowed.");
  if (url.username || url.password) throw new Error("URLs containing credentials are not allowed.");
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (blockedHostnames.has(hostname) || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("Local and private network URLs are not available to internet tools.");
  }
  const addresses = isIP(hostname) ? [hostname] : await resolveHost(hostname);
  if (!addresses.length || addresses.some(isPrivateAddress)) {
    throw new Error("Local and private network URLs are not available to internet tools.");
  }
  return url;
}

async function readLimitedBody(response: Response, maximumBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error(`Response exceeds the ${maximumBytes}-byte limit.`);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error(`Response exceeds the ${maximumBytes}-byte limit.`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function fetchPublicText(value: string, options: Required<Pick<WebToolOptions, "fetch" | "resolveHost" | "timeoutMs" | "maxResponseBytes" | "maxRedirects">>, signal?: AbortSignal): Promise<{ readonly url: string; readonly contentType: string; readonly body: string }> {
  let url = await validatePublicUrl(value, options.resolveHost);
  for (let redirect = 0; redirect <= options.maxRedirects; redirect++) {
    const response = await options.fetch(url, {
      headers: { accept: "text/html, text/plain, application/json, application/xml, text/xml, text/markdown;q=0.9" },
      redirect: "manual",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs)]) : AbortSignal.timeout(options.timeoutMs)
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`Redirect from ${url} did not include a location.`);
      if (redirect === options.maxRedirects) throw new Error("Too many redirects.");
      url = await validatePublicUrl(new URL(location, url).toString(), options.resolveHost);
      continue;
    }
    if (!response.ok) throw new Error(`Request failed with HTTP ${response.status}.`);
    const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "text/plain";
    const supported = contentType.startsWith("text/")
      || contentType === "application/json"
      || contentType === "application/xml"
      || contentType.endsWith("+json")
      || contentType.endsWith("+xml");
    if (!supported) throw new Error(`Unsupported response content type: ${contentType}.`);
    return { url: url.toString(), contentType, body: await readLimitedBody(response, options.maxResponseBytes) };
  }
  throw new Error("Too many redirects.");
}

function htmlToReadableText(html: string): { readonly title?: string; readonly text: string } {
  const $ = load(html);
  const title = $("title").first().text().replace(/\s+/g, " ").trim() || undefined;
  $("script, style, noscript, svg, canvas, iframe").remove();
  const root = $("main").first().length ? $("main").first() : $("article").first().length ? $("article").first() : $("body");
  root.find("address, article, aside, blockquote, br, div, footer, h1, h2, h3, h4, h5, h6, header, li, nav, p, pre, section, table, tr").each((_index, element) => {
    $(element).prepend("\n").append("\n");
  });
  root.find("a[href]").each((_index, element) => {
    const link = $(element);
    const href = link.attr("href");
    const label = link.text().replace(/\s+/g, " ").trim();
    if (href && /^https?:\/\//i.test(href) && label) link.text(`${label} (${href})`);
  });
  return { title, text: root.text().replace(/[ \t]+/g, " ").replace(/\n\s*/g, "\n").replace(/\n{3,}/g, "\n\n").trim() };
}

function dependencies(options: WebToolOptions) {
  return {
    fetch: options.fetch ?? globalThis.fetch,
    resolveHost: options.resolveHost ?? defaultResolveHost,
    timeoutMs: options.timeoutMs ?? 15_000,
    maxResponseBytes: options.maxResponseBytes ?? 750_000,
    maxRedirects: options.maxRedirects ?? 5
  };
}

export function createWebFetchTool(options: WebToolOptions = {}): AgentTool {
  const configured = dependencies(options);
  return {
    name: "web_fetch",
    description: "Read a public HTTP or HTTPS page. Use this for current documentation or a known URL. Local/private network addresses and binary downloads are blocked.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" }, maxCharacters: { type: "number", description: "Maximum returned characters, up to 100000." } },
      required: ["url"]
    },
    async execute(input, context): Promise<ToolResult> {
      const maximumCharacters = positiveInteger(input, "maxCharacters", 30_000, 100_000);
      const response = await fetchPublicText(stringInput(input, "url"), configured, context.signal);
      const readable = response.contentType === "text/html" ? htmlToReadableText(response.body) : { text: response.body };
      const content = readable.text.slice(0, maximumCharacters);
      return {
        content: [`URL: ${response.url}`, readable.title ? `Title: ${readable.title}` : undefined, "", content, readable.text.length > content.length ? "\n[Content truncated]" : undefined].filter((part) => part !== undefined).join("\n")
      };
    }
  };
}

export function createWebSearchTool(options: WebToolOptions = {}): AgentTool {
  const configured = dependencies(options);
  const endpoint = options.searchEndpoint ?? defaultSearchEndpoint;
  return {
    name: "web_search",
    description: "Search the public web for current information. Returns result titles, URLs, and snippets. Use web_fetch to read a selected result.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" }, maxResults: { type: "number", description: "Maximum results, up to 10." } },
      required: ["query"]
    },
    async execute(input, context): Promise<ToolResult> {
      const query = stringInput(input, "query");
      const maximumResults = positiveInteger(input, "maxResults", 5, 10);
      const searchUrl = new URL(endpoint);
      searchUrl.searchParams.set("q", query);
      const response = await fetchPublicText(searchUrl.toString(), configured, context.signal);
      const $ = load(response.body);
      const results: string[] = [];
      $(".result").each((_index, element) => {
        if (results.length >= maximumResults) return false;
        const titleLink = $(element).find(".result__a").first();
        const rawHref = titleLink.attr("href");
        const title = titleLink.text().replace(/\s+/g, " ").trim();
        if (!rawHref || !title) return;
        const parsed = new URL(rawHref, response.url);
        const href = parsed.searchParams.get("uddg") ?? parsed.toString();
        const snippet = $(element).find(".result__snippet").first().text().replace(/\s+/g, " ").trim();
        results.push(`${results.length + 1}. ${title}\n${href}${snippet ? `\n${snippet}` : ""}`);
      });
      return { content: results.join("\n\n") || "No search results were returned." };
    }
  };
}

export function registerWebTools(registry: ToolRegistry, options: WebToolOptions = {}): void {
  registry.register(createWebSearchTool(options));
  registry.register(createWebFetchTool(options));
}
