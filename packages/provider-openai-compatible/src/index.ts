import type {
  ChatMessage,
  JsonObject,
  ModelProvider,
  ModelRequest,
  ModelStreamEvent,
  ToolCall,
  ToolDefinition
} from "@truss-harness/runtime";

export interface OpenAICompatibleProviderOptions {
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey?: string;
  readonly id?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetch?: typeof globalThis.fetch;
}

export type LocalEndpointKind = "ollama" | "openai-compatible";

export interface LocalModelEndpoint {
  readonly id: string;
  readonly label: string;
  readonly kind: LocalEndpointKind;
  readonly baseUrl: string;
}

export interface LocalModel {
  readonly id: string;
  readonly name: string;
}

export interface DetectedLocalModel {
  readonly endpoint: LocalModelEndpoint;
  readonly model: LocalModel;
  /** True only when the server explicitly reports this model as running. */
  readonly active: boolean;
}

export interface LocalModelConfiguration {
  readonly kind: LocalEndpointKind;
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey?: string;
}

export interface LocalTextGenerationOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly signal?: AbortSignal;
}

interface OpenAIChunk {
  readonly choices?: readonly {
    readonly delta?: {
      readonly content?: string | null;
      readonly tool_calls?: readonly {
        readonly index: number;
        readonly id?: string;
        readonly function?: { readonly name?: string; readonly arguments?: string };
      }[];
    };
    readonly finish_reason?: "stop" | "tool_calls" | "length" | null;
  }[];
}

interface PartialToolCall {
  id?: string;
  name?: string;
  arguments: string;
}

/**
 * LM Studio exposes OpenAI-compatible routes below /v1. Older Truss settings
 * sometimes stored its root URL, so repair only that well-known local default.
 * Custom compatible endpoints are otherwise preserved exactly as configured.
 */
export function normalizeLocalBaseUrl(kind: LocalEndpointKind, baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/$/, "");
  if (kind !== "openai-compatible") return normalized;
  try {
    const url = new URL(normalized);
    const isLocalLmStudio = ["127.0.0.1", "localhost", "::1"].includes(url.hostname) && url.port === "1234" && (url.pathname === "" || url.pathname === "/");
    return isLocalLmStudio ? `${url.origin}/v1` : normalized;
  } catch {
    return normalized;
  }
}

function toOpenAIMessage(message: ChatMessage): JsonObject {
  if (message.role === "assistant" && message.toolCalls?.length) {
    return {
      role: "assistant",
      content: message.content || null,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.input) }
      }))
    };
  }

  if (message.role === "tool") {
    return { role: "tool", tool_call_id: message.toolCallId ?? "", content: message.content };
  }

  return { role: message.role, content: message.content };
}

function toOpenAITool(tool: ToolDefinition): JsonObject {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema as unknown as JsonObject
    }
  };
}

function toOllamaMessage(message: ChatMessage): JsonObject {
  if (message.role === "assistant" && message.toolCalls?.length) {
    return {
      role: "assistant",
      content: message.content,
      tool_calls: message.toolCalls.map((call) => ({ function: { name: call.name, arguments: call.input } }))
    };
  }
  if (message.role === "tool") return { role: "tool", content: message.content };
  return { role: message.role, content: message.content };
}

function finishReason(reason: OpenAIChunk["choices"] extends readonly (infer T)[] | undefined
  ? T extends { readonly finish_reason?: infer R } ? R : never
  : never): "stop" | "tool_calls" | "length" {
  return reason === "tool_calls" || reason === "length" ? reason : "stop";
}

function parseToolCalls(partial: Map<number, PartialToolCall>): ToolCall[] {
  return [...partial.entries()].sort(([left], [right]) => left - right).map(([index, call]) => {
    if (!call.id || !call.name) throw new Error(`Incomplete tool call at index ${index}`);

    let input: JsonObject;
    try {
      const parsed: unknown = call.arguments ? JSON.parse(call.arguments) : {};
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("tool arguments must be an object");
      }
      input = parsed as JsonObject;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid arguments for tool '${call.name}': ${message}`);
    }

    return { id: call.id, name: call.name, input };
  });
}

function appendChunk(partial: Map<number, PartialToolCall>, chunk: NonNullable<OpenAIChunk["choices"]>[number]): void {
  for (const call of chunk.delta?.tool_calls ?? []) {
    const current = partial.get(call.index) ?? { arguments: "" };
    current.id ??= call.id;
    current.name ??= call.function?.name;
    current.arguments += call.function?.arguments ?? "";
    partial.set(call.index, current);
  }
}

/** A provider adapter for OpenAI-compatible chat-completions endpoints. */
export class OpenAICompatibleProvider implements ModelProvider {
  readonly id: string;
  private readonly endpoint: string;
  private readonly requestFetch: typeof globalThis.fetch;

  constructor(private readonly options: OpenAICompatibleProviderOptions) {
    this.id = options.id ?? "openai-compatible";
    this.endpoint = `${normalizeLocalBaseUrl("openai-compatible", options.baseUrl)}/chat/completions`;
    this.requestFetch = options.fetch ?? globalThis.fetch;
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    const response = await this.requestFetch(this.endpoint, {
      method: "POST",
      signal: request.signal,
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}),
        ...this.options.headers
      },
      body: JSON.stringify({
        model: this.options.model,
        stream: true,
        messages: request.messages.map(toOpenAIMessage),
        tools: request.tools.map(toOpenAITool)
      })
    });

    if (!response.ok) throw new Error(`Model request failed (${response.status}): ${await response.text()}`);
    if (!response.body) throw new Error("Model response did not include a stream");

    const decoder = new TextDecoder();
    const partialCalls = new Map<number, PartialToolCall>();
    let buffered = "";
    let finalReason: "stop" | "tool_calls" | "length" = "stop";
    let receivedChunk = false;

    for await (const bytes of response.body) {
      buffered += decoder.decode(bytes, { stream: true });
      const events = buffered.split(/\r?\n\r?\n/);
      buffered = events.pop() ?? "";

      for (const event of events) {
        const data = event.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
        if (!data) continue;
        if (data === "[DONE]") {
          for (const call of parseToolCalls(partialCalls)) yield { type: "tool_call", ...call };
          yield { type: "finish", reason: finalReason };
          return;
        }

        const chunk = JSON.parse(data) as OpenAIChunk;
        receivedChunk = true;
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        if (choice.delta?.content) yield { type: "text_delta", text: choice.delta.content };
        appendChunk(partialCalls, choice);
        if (choice.finish_reason) finalReason = finishReason(choice.finish_reason);
      }
    }

    // Some local OpenAI-compatible servers close after the final JSON event rather
    // than sending the optional OpenAI [DONE] marker. Process that buffered event
    // and accept a clean close after at least one valid chunk.
    buffered += decoder.decode();
    const trailingData = buffered.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
    if (trailingData === "[DONE]") {
      for (const call of parseToolCalls(partialCalls)) yield { type: "tool_call", ...call };
      yield { type: "finish", reason: finalReason };
      return;
    }
    if (trailingData) {
      const chunk = JSON.parse(trailingData) as OpenAIChunk;
      receivedChunk = true;
      const choice = chunk.choices?.[0];
      if (choice?.delta?.content) yield { type: "text_delta", text: choice.delta.content };
      if (choice) {
        appendChunk(partialCalls, choice);
        if (choice.finish_reason) finalReason = finishReason(choice.finish_reason);
      }
    }
    if (receivedChunk) {
      for (const call of parseToolCalls(partialCalls)) yield { type: "tool_call", ...call };
      yield { type: "finish", reason: finalReason };
      return;
    }

    throw new Error("Model stream ended before its [DONE] marker");
  }
}

/** Native Ollama adapter. Ollama's native API preserves local tool-calling semantics. */
export class OllamaProvider implements ModelProvider {
  readonly id = "ollama";
  private readonly endpoint: string;
  private readonly requestFetch: typeof globalThis.fetch;

  constructor(options: Omit<OpenAICompatibleProviderOptions, "id">) {
    this.endpoint = `${options.baseUrl.replace(/\/$/, "")}/api/chat`;
    this.options = options;
    this.requestFetch = options.fetch ?? globalThis.fetch;
  }

  private readonly options: Omit<OpenAICompatibleProviderOptions, "id">;

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    const response = await this.requestFetch(this.endpoint, {
      method: "POST",
      signal: request.signal,
      headers: {
        "content-type": "application/json",
        ...(this.options.headers ?? {})
      },
      body: JSON.stringify({
        model: this.options.model,
        stream: true,
        messages: request.messages.map(toOllamaMessage),
        tools: request.tools.map(toOpenAITool)
      })
    });
    if (!response.ok) throw new Error(`Ollama request failed (${response.status}): ${await response.text()}`);
    if (!response.body) throw new Error("Ollama response did not include a stream");

    const decoder = new TextDecoder();
    let buffered = "";
    let callIndex = 0;
    for await (const bytes of response.body) {
      buffered += decoder.decode(bytes, { stream: true });
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const chunk = JSON.parse(line) as {
          readonly message?: { readonly content?: string; readonly tool_calls?: readonly { readonly function: { readonly name: string; readonly arguments: JsonObject } }[] };
          readonly done?: boolean;
          readonly done_reason?: "stop" | "length";
        };
        if (chunk.message?.content) yield { type: "text_delta", text: chunk.message.content };
        for (const toolCall of chunk.message?.tool_calls ?? []) {
          yield { type: "tool_call", id: `ollama-${++callIndex}`, name: toolCall.function.name, input: toolCall.function.arguments };
        }
        if (chunk.done) {
          yield { type: "finish", reason: chunk.done_reason === "length" ? "length" : "stop" };
          return;
        }
      }
    }
    throw new Error("Ollama stream ended before its final response.");
  }
}

const defaultLocalEndpoints: readonly LocalModelEndpoint[] = [
  { id: "ollama", label: "Ollama", kind: "ollama", baseUrl: "http://127.0.0.1:11434" },
  { id: "lm-studio", label: "LM Studio", kind: "openai-compatible", baseUrl: "http://127.0.0.1:1234/v1" },
  { id: "llama-cpp", label: "llama.cpp server", kind: "openai-compatible", baseUrl: "http://127.0.0.1:8080/v1" }
];

function modelsUrl(endpoint: LocalModelEndpoint): string {
  return endpoint.kind === "ollama"
    ? `${endpoint.baseUrl.replace(/\/$/, "")}/api/tags`
    : `${normalizeLocalBaseUrl(endpoint.kind, endpoint.baseUrl)}/models`;
}

/** Lists models advertised by a local endpoint. A missing model route is reported as an empty list. */
export async function listLocalModels(endpoint: LocalModelEndpoint, options: { fetch?: typeof globalThis.fetch; signal?: AbortSignal } = {}): Promise<readonly LocalModel[]> {
  const response = await (options.fetch ?? globalThis.fetch)(modelsUrl(endpoint), { signal: options.signal });
  if (!response.ok) throw new Error(`${endpoint.label} model discovery failed (${response.status}).`);
  const payload = await response.json() as { readonly models?: readonly { readonly name?: string; readonly model?: string }[]; readonly data?: readonly { readonly id: string }[] };
  if (endpoint.kind === "ollama") {
    return (payload.models ?? []).flatMap((model) => {
      const name = model.name ?? model.model;
      return name ? [{ id: name, name }] : [];
    });
  }
  return (payload.data ?? []).map((model) => ({ id: model.id, name: model.id }));
}

async function listActiveOllamaModels(endpoint: LocalModelEndpoint, options: { fetch?: typeof globalThis.fetch; signal?: AbortSignal } = {}): Promise<readonly LocalModel[]> {
  const response = await (options.fetch ?? globalThis.fetch)(`${endpoint.baseUrl.replace(/\/$/, "")}/api/ps`, { signal: options.signal });
  if (!response.ok) return [];
  const payload = await response.json() as { readonly models?: readonly { readonly name?: string; readonly model?: string }[] };
  return (payload.models ?? []).flatMap((model) => {
    const name = model.name ?? model.model;
    return name ? [{ id: name, name }] : [];
  });
}

/** Detects the standard local model servers without assuming any one of them is installed. */
export async function detectLocalEndpoints(options: { fetch?: typeof globalThis.fetch; endpoints?: readonly LocalModelEndpoint[] } = {}): Promise<readonly LocalModelEndpoint[]> {
  const endpoints = options.endpoints ?? defaultLocalEndpoints;
  const requestFetch = options.fetch ?? globalThis.fetch;
  const available = await Promise.all(endpoints.map(async (endpoint) => {
    try {
      await listLocalModels(endpoint, { fetch: requestFetch, signal: AbortSignal.timeout(750) });
      return endpoint;
    } catch {
      return undefined;
    }
  }));
  return available.filter((endpoint): endpoint is LocalModelEndpoint => endpoint !== undefined);
}

/** Finds a usable local model, preferring an Ollama model the server reports as currently running. */
export async function detectActiveLocalModel(options: { fetch?: typeof globalThis.fetch; endpoints?: readonly LocalModelEndpoint[] } = {}): Promise<DetectedLocalModel | undefined> {
  const requestFetch = options.fetch ?? globalThis.fetch;
  const endpoints = options.endpoints ?? await detectLocalEndpoints({ fetch: requestFetch });
  for (const endpoint of endpoints) {
    if (endpoint.kind === "ollama") {
      try {
        const active = await listActiveOllamaModels(endpoint, { fetch: requestFetch, signal: AbortSignal.timeout(750) });
        if (active[0]) return { endpoint, model: active[0], active: true };
      } catch { /* Installed models remain a useful fallback. */ }
    }
    try {
      const models = await listLocalModels(endpoint, { fetch: requestFetch, signal: AbortSignal.timeout(750) });
      if (models[0]) return { endpoint, model: models[0], active: false };
    } catch { /* Try the next detected endpoint. */ }
  }
  return undefined;
}

/** Reads the configured context window from LM Studio's native model-management API when available. */
export async function detectLocalContextWindow(endpoint: LocalModelEndpoint, model: string, options: { fetch?: typeof globalThis.fetch; signal?: AbortSignal } = {}): Promise<number | undefined> {
  if (endpoint.kind !== "openai-compatible" || !model.trim()) return undefined;
  let base: URL;
  try { base = new URL(endpoint.baseUrl); } catch { return undefined; }
  const response = await (options.fetch ?? globalThis.fetch)(new URL("/api/v1/models", base.origin), { signal: options.signal });
  if (!response.ok) return undefined;
  type ContextConfig = {
    readonly context_length?: number;
    readonly contextLength?: number;
    readonly context_window?: number;
    readonly n_ctx?: number;
  };
  type ModelInstance = {
    readonly id?: string;
    readonly config?: ContextConfig;
  };
  type LocalModel = ContextConfig & {
    readonly id?: string;
    readonly key?: string;
    readonly model?: string;
    readonly name?: string;
    readonly display_name?: string;
    readonly config?: ContextConfig;
    readonly loaded_instances?: readonly ModelInstance[];
  };
  const payload = await response.json() as { readonly data?: readonly LocalModel[]; readonly models?: readonly LocalModel[] };
  const models = payload.models ?? payload.data ?? [];
  const item = models.find((candidate) => [
    candidate.id,
    candidate.key,
    candidate.model,
    candidate.name,
    candidate.display_name,
    ...(candidate.loaded_instances?.map((instance) => instance.id) ?? [])
  ].includes(model));
  if (!item) return undefined;

  const values = [
    item.loaded_instances?.find((instance) => instance.id === model)?.config,
    item.loaded_instances?.[0]?.config,
    item.config,
    item
  ].flatMap((source) => source ? [source.context_length, source.contextLength, source.context_window, source.n_ctx] : []);
  const value = values.find((candidate) => typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 512);
  return typeof value === "number" ? Math.floor(value) : undefined;
}

export function createLocalModelProvider(configuration: LocalModelConfiguration): ModelProvider {
  if (configuration.kind === "ollama") {
    return new OllamaProvider({ baseUrl: configuration.baseUrl, model: configuration.model, apiKey: configuration.apiKey });
  }
  return new OpenAICompatibleProvider({ baseUrl: configuration.baseUrl, model: configuration.model, apiKey: configuration.apiKey });
}

/** Generates a single response without SSE, for small local actions that need a reliable final value. */
export async function generateLocalText(configuration: LocalModelConfiguration, prompt: string, options: LocalTextGenerationOptions = {}): Promise<string> {
  const requestFetch = options.fetch ?? globalThis.fetch;
  const endpoint = configuration.kind === "ollama"
    ? `${configuration.baseUrl.replace(/\/$/, "")}/api/chat`
    : `${normalizeLocalBaseUrl(configuration.kind, configuration.baseUrl)}/chat/completions`;
  const response = await requestFetch(endpoint, {
    method: "POST",
    signal: options.signal,
    headers: {
      "content-type": "application/json",
      ...(configuration.apiKey ? { authorization: `Bearer ${configuration.apiKey}` } : {})
    },
    body: JSON.stringify({
      model: configuration.model,
      stream: false,
      messages: [{ role: "user", content: prompt }]
    })
  });
  if (!response.ok) throw new Error(`Model request failed (${response.status}): ${await response.text()}`);

  const payload = await response.json() as {
    readonly message?: { readonly content?: unknown };
    readonly response?: unknown;
    readonly choices?: readonly { readonly message?: { readonly content?: unknown }; readonly text?: unknown }[];
  };
  const content = configuration.kind === "ollama"
    ? payload.message?.content ?? payload.response
    : payload.choices?.[0]?.message?.content ?? payload.choices?.[0]?.text;
  if (typeof content !== "string" || !content.trim()) throw new Error("The model returned an empty response.");
  return content;
}
