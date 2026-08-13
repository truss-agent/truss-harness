import type {
  ChatMessage,
  JsonObject,
  ModelTokenUsage,
  ToolCall,
  ToolDefinition,
} from "@truss-harness/runtime";

export type OpenAIContent =
  | string
  | null
  | readonly {
      readonly type?: string;
      readonly text?: string | { readonly value?: string };
    }[];

export interface OpenAIToolCallChunk {
  readonly index?: number;
  readonly id?: string;
  readonly function?: { readonly name?: string; readonly arguments?: string };
}

export interface OpenAIChoice {
  readonly delta?: {
    readonly content?: OpenAIContent;
    readonly tool_calls?: readonly OpenAIToolCallChunk[];
  };
  readonly message?: {
    readonly content?: OpenAIContent;
    readonly tool_calls?: readonly OpenAIToolCallChunk[];
  };
  readonly finish_reason?: string | null;
}

export interface OpenAIChunk {
  readonly choices?: readonly OpenAIChoice[];
  readonly error?: unknown;
  readonly usage?: unknown;
}

export interface PartialToolCall {
  id?: string;
  name?: string;
  arguments: string;
}

export function tokenUsage(value: unknown): ModelTokenUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  const input = Number(
    source.prompt_tokens ?? source.input_tokens ?? source.prompt_eval_count,
  );
  const output = Number(
    source.completion_tokens ?? source.output_tokens ?? source.eval_count,
  );
  const total = Number(source.total_tokens);
  if (!Number.isFinite(input) && !Number.isFinite(output)) return undefined;
  const inputTokens = Number.isFinite(input) ? Math.max(0, input) : 0;
  const outputTokens = Number.isFinite(output) ? Math.max(0, output) : 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens:
      Number.isFinite(total) && total >= 0 ? total : inputTokens + outputTokens,
  };
}

export function toOpenAIMessage(message: ChatMessage): JsonObject {
  if (message.role === "assistant" && message.toolCalls?.length) {
    return {
      role: "assistant",
      content: message.content || null,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.input) },
      })),
    };
  }
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId ?? "",
      content: message.content,
    };
  }
  const fileContext = (message.attachments ?? [])
    .filter((attachment) => attachment.kind === "file")
    .map(
      (attachment) =>
        `Attached file: ${attachment.name} (${attachment.mediaType}, ${attachment.size} bytes)${attachment.text ? `\n\n${attachment.text}` : ""}`,
    )
    .join("\n\n");
  const text = [message.content, fileContext].filter(Boolean).join("\n\n");
  const imageParts = (message.attachments ?? []).flatMap((attachment) =>
    attachment.kind === "image" && attachment.data
      ? [{ type: "image_url", image_url: { url: attachment.data } }]
      : [],
  );
  return imageParts.length
    ? { role: message.role, content: [{ type: "text", text }, ...imageParts] }
    : { role: message.role, content: text };
}

export function toOpenAITool(tool: ToolDefinition): JsonObject {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema as unknown as JsonObject,
    },
  };
}

export function toOllamaMessage(message: ChatMessage): JsonObject {
  if (message.role === "assistant" && message.toolCalls?.length) {
    return {
      role: "assistant",
      content: message.content,
      tool_calls: message.toolCalls.map((call) => ({
        function: { name: call.name, arguments: call.input },
      })),
    };
  }
  if (message.role === "tool")
    return { role: "tool", content: message.content };
  const fileContext = (message.attachments ?? [])
    .filter((attachment) => attachment.kind === "file")
    .map(
      (attachment) =>
        `Attached file: ${attachment.name} (${attachment.mediaType}, ${attachment.size} bytes)${attachment.text ? `\n\n${attachment.text}` : ""}`,
    )
    .join("\n\n");
  const images = (message.attachments ?? [])
    .filter((attachment) => attachment.kind === "image" && attachment.data)
    .flatMap(
      (attachment) =>
        attachment.data?.match(/^data:[^;,]+;base64,(.+)$/)?.[1] ?? [],
    );
  return {
    role: message.role,
    content: [message.content, fileContext].filter(Boolean).join("\n\n"),
    ...(images.length ? { images } : {}),
  };
}

export function finishReason(
  reason: string | null | undefined,
): "stop" | "tool_calls" | "length" {
  return reason === "tool_calls" || reason === "length" ? reason : "stop";
}

export function contentText(content: OpenAIContent | undefined): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part.text === "string") return part.text;
      return part.text?.value ?? "";
    })
    .join("");
}

export function parseToolCalls(
  partial: Map<number, PartialToolCall>,
): ToolCall[] {
  return [...partial.entries()]
    .sort(([left], [right]) => left - right)
    .map(([index, call]) => {
      if (!call.name) throw new Error(`Incomplete tool call at index ${index}`);
      try {
        const parsed: unknown = call.arguments
          ? JSON.parse(call.arguments)
          : {};
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
          throw new Error("tool arguments must be an object");
        return {
          id: call.id ?? `tool-${index}`,
          name: call.name,
          input: parsed as JsonObject,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          id: call.id ?? `malformed-tool-${index}`,
          name: call.name,
          input: {},
          parseError: `Invalid arguments for tool '${call.name}': ${message}`,
        };
      }
    });
}

export function appendChunk(
  partial: Map<number, PartialToolCall>,
  choice: OpenAIChoice,
): void {
  const calls = choice.delta?.tool_calls ?? choice.message?.tool_calls ?? [];
  calls.forEach((call, position) => {
    const index = call.index ?? position;
    const current = partial.get(index) ?? { arguments: "" };
    current.id ??= call.id;
    current.name ??= call.function?.name;
    current.arguments += call.function?.arguments ?? "";
    partial.set(index, current);
  });
}
