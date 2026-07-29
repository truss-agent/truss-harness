import type {
  ChatAttachment,
  ChatMessage,
  ContextBlock,
} from "@truss-harness/runtime";

const maximumContextBlocks = 24;
const maximumContextCharacters = 250_000;
const maximumAttachments = 16;
const maximumAttachmentCharacters = 10_000_000;
const maximumSessionMessages = 200;
const maximumSessionCharacters = 1_000_000;
const maximumPromptCharacters = 200_000;

export function protocolObject(
  value: unknown,
): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function validRequestId(value: unknown): value is string {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= 200
  );
}

export function sanitizePrompt(value: unknown): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error("A run request needs a non-empty prompt.");
  if (value.length > maximumPromptCharacters)
    throw new Error(
      `A run prompt may contain at most ${maximumPromptCharacters} characters.`,
    );
  return value;
}

export function sanitizeContext(value: unknown): readonly ContextBlock[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximumContextBlocks)
    throw new Error(
      `Context must contain at most ${maximumContextBlocks} blocks.`,
    );
  let total = 0;
  return value.map((candidate) => {
    const block = protocolObject(candidate);
    if (
      !block ||
      typeof block.source !== "string" ||
      !block.source.trim() ||
      block.source.length > 1_000 ||
      typeof block.content !== "string" ||
      (block.priority !== undefined && typeof block.priority !== "number")
    )
      throw new Error("Every context block needs a source and string content.");
    total += block.content.length;
    if (total > maximumContextCharacters)
      throw new Error(
        `Context may contain at most ${maximumContextCharacters} characters.`,
      );
    return {
      source: block.source,
      content: block.content,
      ...(typeof block.priority === "number"
        ? { priority: block.priority }
        : {}),
    };
  });
}

export function sanitizeAttachments(value: unknown): readonly ChatAttachment[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximumAttachments)
    throw new Error(
      `A request may contain at most ${maximumAttachments} attachments.`,
    );
  let total = 0;
  return value.map((candidate) => {
    const attachment = protocolObject(candidate);
    if (
      !attachment ||
      (attachment.kind !== "image" && attachment.kind !== "file") ||
      typeof attachment.id !== "string" ||
      !attachment.id ||
      attachment.id.length > 500 ||
      typeof attachment.name !== "string" ||
      !attachment.name ||
      attachment.name.length > 1_000 ||
      typeof attachment.mediaType !== "string" ||
      !attachment.mediaType ||
      attachment.mediaType.length > 200 ||
      typeof attachment.size !== "number" ||
      attachment.size < 0 ||
      (attachment.data !== undefined && typeof attachment.data !== "string") ||
      (attachment.text !== undefined && typeof attachment.text !== "string")
    )
      throw new Error("An attachment contains invalid metadata or content.");
    total +=
      (typeof attachment.data === "string" ? attachment.data.length : 0) +
      (typeof attachment.text === "string" ? attachment.text.length : 0);
    if (total > maximumAttachmentCharacters)
      throw new Error("The request attachment payload is too large.");
    return attachment as unknown as ChatAttachment;
  });
}

export function sanitizeMessages(value: unknown): readonly ChatMessage[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximumSessionMessages)
    throw new Error(
      `A session may contain at most ${maximumSessionMessages} messages.`,
    );
  let total = 0;
  return value.map((candidate) => {
    const message = protocolObject(candidate);
    if (
      !message ||
      (message.role !== "system" &&
        message.role !== "user" &&
        message.role !== "assistant" &&
        message.role !== "tool") ||
      typeof message.content !== "string" ||
      (message.name !== undefined && typeof message.name !== "string") ||
      (typeof message.name === "string" && message.name.length > 1_000) ||
      (message.toolCallId !== undefined &&
        typeof message.toolCallId !== "string") ||
      (typeof message.toolCallId === "string" &&
        message.toolCallId.length > 500)
    )
      throw new Error(
        "Every session message needs a valid role and string content.",
      );
    total += message.content.length;
    if (total > maximumSessionCharacters)
      throw new Error(
        `Session history may contain at most ${maximumSessionCharacters} characters.`,
      );
    const attachments = sanitizeAttachments(message.attachments);
    return {
      role: message.role,
      content: message.content,
      ...(attachments.length ? { attachments } : {}),
      ...(typeof message.name === "string" ? { name: message.name } : {}),
      ...(typeof message.toolCallId === "string"
        ? { toolCallId: message.toolCallId }
        : {}),
    };
  });
}

export function requestError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
