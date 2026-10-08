import type {
  ChatAttachment,
  ChatMessage,
  CredentialProvider,
  JsonObject,
  ModelProvider,
  ModelRequest,
  ModelStreamEvent,
  ModelTokenUsage,
  ResolvedCredential,
  ToolCall,
  ToolDefinition,
} from "@truss-harness/runtime";
import { ApiKeyCredential } from "@truss-harness/runtime";
import type { AnthropicProviderOptions } from "./contracts.js";
import { requestError } from "./errors.js";

const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 8_192;

type ContentBlock = Record<string, unknown>;

interface AnthropicMessage {
  readonly role: "user" | "assistant";
  content: ContentBlock[];
}

interface AnthropicStreamBlock {
  readonly type?: string;
  readonly id?: string;
  readonly name?: string;
  readonly input?: unknown;
  arguments: string;
}

interface AnthropicUsage {
  readonly input_tokens?: unknown;
  readonly output_tokens?: unknown;
}

interface AnthropicPayload {
  readonly type?: string;
  readonly index?: number;
  readonly message?: { readonly usage?: AnthropicUsage };
  readonly content_block?: {
    readonly type?: string;
    readonly id?: string;
    readonly name?: string;
    readonly input?: unknown;
  };
  readonly delta?: {
    readonly type?: string;
    readonly text?: string;
    readonly partial_json?: string;
    readonly stop_reason?: string | null;
  };
  readonly content?: readonly {
    readonly type?: string;
    readonly text?: string;
    readonly id?: string;
    readonly name?: string;
    readonly input?: unknown;
  }[];
  readonly stop_reason?: string | null;
  readonly usage?: AnthropicUsage;
  readonly error?: unknown;
}

function applyCredential(
  headers: Headers,
  credential: Exclude<ResolvedCredential, { readonly kind: "request-signer" }>,
): void {
  if (credential.kind === "bearer") {
    // Anthropic API keys use x-api-key. OAuth tokens use the bearer header.
    if (/^sk-ant-oat/i.test(credential.token))
      headers.set("authorization", `Bearer ${credential.token}`);
    else headers.set("x-api-key", credential.token);
  } else headers.set(credential.name, credential.value);
}

function textBlock(text: string): ContentBlock[] {
  return text ? [{ type: "text", text }] : [];
}

function imageBlock(attachment: ChatAttachment): ContentBlock | undefined {
  const data = attachment.data?.match(/^data:([^;,]+);base64,(.+)$/);
  if (!data) return undefined;
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: data[1] || attachment.mediaType,
      data: data[2],
    },
  };
}

function fileBlock(attachment: ChatAttachment): ContentBlock {
  return {
    type: "text",
    text: `Attached file: ${attachment.name} (${attachment.mediaType}, ${attachment.size} bytes)${attachment.text ? `\n\n${attachment.text}` : ""}`,
  };
}

function userBlocks(
  message: ChatMessage & { readonly role: "user" },
): ContentBlock[] {
  const blocks = textBlock(message.content);
  for (const attachment of message.attachments ?? []) {
    if (attachment.kind === "file") blocks.push(fileBlock(attachment));
    else {
      const image = imageBlock(attachment);
      if (image) blocks.push(image);
    }
  }
  return blocks.length ? blocks : [{ type: "text", text: "" }];
}

function assistantBlocks(
  message: ChatMessage & { readonly role: "assistant" },
): ContentBlock[] {
  const blocks = textBlock(message.content);
  for (const call of message.toolCalls ?? []) {
    blocks.push({
      type: "tool_use",
      id: call.id,
      name: call.name,
      input: call.input,
    });
  }
  return blocks.length ? blocks : [{ type: "text", text: "" }];
}

function toolBlocks(
  message: ChatMessage & { readonly role: "tool" },
): ContentBlock[] {
  return [
    {
      type: "tool_result",
      tool_use_id: message.toolCallId ?? "",
      content: message.content,
    },
  ];
}

function requestMessages(messages: readonly ChatMessage[]): {
  readonly system?: string;
  readonly messages: readonly AnthropicMessage[];
} {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join("\n\n");
  const converted: AnthropicMessage[] = [];
  for (const message of messages) {
    if (message.role === "system") continue;
    const role = message.role === "assistant" ? "assistant" : "user";
    const content =
      message.role === "assistant"
        ? assistantBlocks(
            message as ChatMessage & { readonly role: "assistant" },
          )
        : message.role === "tool"
          ? toolBlocks(message as ChatMessage & { readonly role: "tool" })
          : userBlocks(message as ChatMessage & { readonly role: "user" });
    const previous = converted.at(-1);
    if (previous?.role === role) {
      previous.content = [...previous.content, ...content];
    } else converted.push({ role, content });
  }
  return system ? { system, messages: converted } : { messages: converted };
}

function anthropicTool(tool: ToolDefinition): ContentBlock {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  };
}

function numberValue(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function usageValue(
  inputTokens: number | undefined,
  outputTokens: number | undefined,
): ModelTokenUsage | undefined {
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  const input = inputTokens ?? 0;
  const output = outputTokens ?? 0;
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: input + output,
  };
}

function finishReason(
  reason: string | null | undefined,
  hasToolCalls: boolean,
): "stop" | "tool_calls" | "length" {
  if (reason === "tool_use" || hasToolCalls) return "tool_calls";
  if (reason === "max_tokens" || reason === "model_context_window_exceeded")
    return "length";
  return "stop";
}

function parseInput(
  block: AnthropicStreamBlock,
  index: number,
): { readonly input: JsonObject; readonly parseError?: string } {
  const raw = block.arguments.trim();
  const value = raw
    ? (() => {
        try {
          return JSON.parse(raw) as unknown;
        } catch (error) {
          return error;
        }
      })()
    : block.input;
  if (value instanceof Error)
    return {
      input: {},
      parseError: `Invalid arguments for tool '${block.name ?? `tool-${index}`}': ${value.message}`,
    };
  if (!value || typeof value !== "object" || Array.isArray(value))
    return {
      input: {},
      parseError: `Invalid arguments for tool '${block.name ?? `tool-${index}`}': tool input must be an object`,
    };
  return { input: value as JsonObject };
}

function toolCalls(blocks: Map<number, AnthropicStreamBlock>): ToolCall[] {
  return [...blocks.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([index, block]) => {
      if (block.type !== "tool_use" || !block.name) return [];
      const parsed = parseInput(block, index);
      return [{ id: block.id ?? `tool-${index}`, name: block.name, ...parsed }];
    });
}

function parsePayload(value: string): AnthropicPayload {
  try {
    return JSON.parse(value) as AnthropicPayload;
  } catch {
    throw new Error("Anthropic response contained invalid JSON.");
  }
}

function dataFromEvent(block: string): string | undefined {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n");
  return data || undefined;
}

/** Native Anthropic Messages API adapter for the provider-neutral runtime contract. */
export class AnthropicProvider implements ModelProvider {
  readonly id = "anthropic";
  private readonly endpoint: string;
  private readonly requestFetch: typeof globalThis.fetch;

  constructor(private readonly options: AnthropicProviderOptions) {
    this.endpoint = `${options.baseUrl.replace(/\/$/, "")}/messages`;
    this.requestFetch = options.fetch ?? globalThis.fetch;
  }

  private credential(): CredentialProvider | undefined {
    return (
      this.options.credential ??
      (this.options.apiKey
        ? new ApiKeyCredential("anthropic-api-key", this.options.apiKey)
        : undefined)
    );
  }

  private async send(request: ModelRequest): Promise<Response> {
    const converted = requestMessages(request.messages);
    const maxTokens = Math.max(
      1,
      Math.floor(this.options.maxTokens ?? DEFAULT_MAX_TOKENS),
    );
    const payload = {
      model: this.options.model,
      max_tokens: maxTokens,
      stream: true,
      ...(converted.system ? { system: converted.system } : {}),
      messages: converted.messages,
      ...(request.tools.length
        ? { tools: request.tools.map(anthropicTool) }
        : {}),
    };
    const body = JSON.stringify(payload);
    const credential = this.credential();
    const attempt = async (): Promise<Response> => {
      const headers = new Headers({
        "content-type": "application/json",
        accept: "text/event-stream",
        "anthropic-version": ANTHROPIC_VERSION,
        ...this.options.headers,
      });
      const resolved = await credential?.resolve();
      if (resolved?.kind === "request-signer") {
        return this.requestFetch(
          await resolved.sign(
            new Request(this.endpoint, {
              method: "POST",
              signal: request.signal,
              headers,
              body,
            }),
          ),
        );
      }
      if (resolved) applyCredential(headers, resolved);
      return this.requestFetch(this.endpoint, {
        method: "POST",
        signal: request.signal,
        headers,
        body,
      });
    };

    let response = await attempt();
    if (
      (response.status === 401 || response.status === 403) &&
      credential?.refresh
    ) {
      await response.body?.cancel();
      await credential.refresh();
      response = await attempt();
    }
    return response;
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    const response = await this.send(request);
    if (!response.ok)
      throw await requestError(response, "Anthropic", this.options.model);

    const blocks = new Map<number, AnthropicStreamBlock>();
    let receivedText = false;
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let stopReason: string | null | undefined;
    let ended = false;

    const finish = (): {
      readonly calls: ToolCall[];
      readonly reason: "stop" | "tool_calls" | "length";
      readonly usage?: ModelTokenUsage;
    } => {
      const calls = toolCalls(blocks);
      if (!receivedText && calls.length === 0)
        throw new Error(
          "Anthropic response did not include text or tool calls.",
        );
      const usage = usageValue(inputTokens, outputTokens);
      return {
        calls,
        reason: finishReason(stopReason, calls.length > 0),
        ...(usage ? { usage } : {}),
      };
    };

    const processPayload = (payload: AnthropicPayload): string | undefined => {
      if (payload.type === "error")
        throw new Error("Anthropic provider returned an error response.");
      if (payload.type === "message_start") {
        inputTokens =
          numberValue(payload.message?.usage?.input_tokens) ?? inputTokens;
        outputTokens =
          numberValue(payload.message?.usage?.output_tokens) ?? outputTokens;
      } else if (payload.type === "content_block_start") {
        const index = payload.index ?? blocks.size;
        const block = payload.content_block;
        blocks.set(index, {
          type: block?.type,
          id: block?.id,
          name: block?.name,
          input: block?.input,
          arguments: "",
        });
      } else if (payload.type === "content_block_delta") {
        const index = payload.index ?? 0;
        const block = blocks.get(index) ?? { arguments: "" };
        if (payload.delta?.type === "input_json_delta")
          block.arguments += payload.delta.partial_json ?? "";
        blocks.set(index, block);
        if (payload.delta?.type === "text_delta")
          return payload.delta.text ?? "";
      } else if (payload.type === "message_delta") {
        stopReason = payload.delta?.stop_reason ?? stopReason;
        inputTokens = numberValue(payload.usage?.input_tokens) ?? inputTokens;
        outputTokens =
          numberValue(payload.usage?.output_tokens) ?? outputTokens;
      } else if (payload.type === "message_stop") ended = true;
      return undefined;
    };

    const emitCompleted = function* (): Generator<ModelStreamEvent> {
      const completed = finish();
      for (const call of completed.calls) yield { type: "tool_call", ...call };
      yield {
        type: "finish",
        reason: completed.reason,
        ...(completed.usage ? { usage: completed.usage } : {}),
      };
    };

    const contentType =
      response.headers.get("content-type")?.toLowerCase() ?? "";
    if (
      contentType.includes("application/json") ||
      contentType.includes("+json")
    ) {
      const payload = parsePayload(await response.text());
      for (const [index, block] of (payload.content ?? []).entries()) {
        if (block.type === "text" && block.text) {
          receivedText = true;
          yield { type: "text_delta", text: block.text };
        } else if (block.type === "tool_use") {
          blocks.set(index, {
            type: block.type,
            id: block.id,
            name: block.name,
            input: block.input,
            arguments: "",
          });
        }
      }
      inputTokens = numberValue(payload.usage?.input_tokens);
      outputTokens = numberValue(payload.usage?.output_tokens);
      stopReason = payload.stop_reason;
      yield* emitCompleted();
      return;
    }
    if (!response.body)
      throw new Error("Anthropic response did not include a stream");

    const decoder = new TextDecoder();
    let buffered = "";
    const processEvent = function* (
      event: string,
    ): Generator<ModelStreamEvent> {
      const data = dataFromEvent(event);
      if (!data || data === "[DONE]") return;
      const text = processPayload(parsePayload(data));
      if (text) {
        receivedText = true;
        yield { type: "text_delta", text };
      }
      if (ended) yield* emitCompleted();
    };

    for await (const bytes of response.body) {
      buffered += decoder.decode(bytes, { stream: true });
      const events = buffered.split(/\r?\n\r?\n/);
      buffered = events.pop() ?? "";
      for (const event of events) {
        yield* processEvent(event);
        if (ended) return;
      }
    }
    buffered += decoder.decode();
    if (buffered.trim()) {
      yield* processEvent(buffered);
      if (ended) return;
    }
    if (receivedText || blocks.size) yield* emitCompleted();
    else throw new Error("Anthropic stream ended before message_stop.");
  }
}
