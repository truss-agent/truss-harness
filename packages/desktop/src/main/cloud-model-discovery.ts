import type { CloudProviderDefinition } from "@truss-harness/provider-openai-compatible";
import type { DesktopModelInfo } from "../shared.js";
import {
  modelInfoFromRecord,
  usableChatModels,
} from "./desktop-configuration.js";

async function safeFailureDetail(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as {
      readonly error?: { readonly message?: unknown };
      readonly message?: unknown;
    };
    const message = payload.error?.message ?? payload.message;
    if (typeof message !== "string") return "";
    return message
      .replace(/sk-ant-[a-zA-Z0-9_-]+/g, "[redacted]")
      .replace(/bearer\s+[^\s]+/gi, "Bearer [redacted]")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 240);
  } catch {
    return "";
  }
}

/** Lists cloud models without depending on Electron or credential storage. */
export async function discoverCloudModels(
  definition: CloudProviderDefinition,
  baseUrl: string,
  credential: string,
  requestFetch: typeof fetch = globalThis.fetch,
): Promise<readonly DesktopModelInfo[]> {
  const root = baseUrl.replace(/\/$/, "");
  const ollama = definition.compatibility === "ollama-api";
  const anthropic = definition.id === "anthropic";
  let headers: Record<string, string> = anthropic
    ? credential.startsWith("sk-ant-oat")
      ? {
          Authorization: `Bearer ${credential}`,
          "anthropic-version": "2023-06-01",
        }
      : { "x-api-key": credential, "anthropic-version": "2023-06-01" }
    : { Authorization: `Bearer ${credential}` };
  const anthropicFallbackHeaders: Record<string, string> | undefined =
    anthropic
      ? headers.Authorization
        ? { "x-api-key": credential, "anthropic-version": "2023-06-01" }
        : {
            Authorization: `Bearer ${credential}`,
            "anthropic-version": "2023-06-01",
          }
      : undefined;
  const records: unknown[] = [];
  let nextUrl: string | undefined = `${root}/${ollama ? "api/tags" : "models"}`;
  for (let page = 0; nextUrl && page < 20; page += 1) {
    let response = await requestFetch(nextUrl, { headers });
    if (
      !response.ok &&
      response.status === 400 &&
      anthropicFallbackHeaders
    ) {
      response = await requestFetch(nextUrl, { headers: anthropicFallbackHeaders });
      if (response.ok) headers = anthropicFallbackHeaders;
    }
    if (!response.ok) {
      const detail = await safeFailureDetail(response);
      throw new Error(
        `${definition.label} model discovery failed (${response.status})${detail ? `: ${detail}` : "."}`,
      );
    }
    const payload = (await response.json()) as {
      readonly data?: readonly unknown[];
      readonly models?: readonly unknown[];
      readonly nextPageToken?: string;
      readonly has_more?: boolean;
      readonly last_id?: string | null;
    };
    records.push(...(ollama ? (payload.models ?? []) : (payload.data ?? [])));
    const pagedUrl: URL = new URL(nextUrl);
    if (anthropic && payload.has_more && payload.last_id) {
      if (pagedUrl.searchParams.get("after_id") === payload.last_id) break;
      pagedUrl.searchParams.set("after_id", payload.last_id);
      nextUrl = pagedUrl.toString();
    } else if (!anthropic && !ollama && payload.nextPageToken) {
      pagedUrl.searchParams.set("pageToken", payload.nextPageToken);
      nextUrl = pagedUrl.toString();
    } else nextUrl = undefined;
  }
  const models = usableChatModels(
    records.flatMap((record) => {
      const info = modelInfoFromRecord(record, definition.id);
      return info ? [info] : [];
    }),
  );
  return [...new Map(models.map((model) => [model.id, model])).values()];
}
