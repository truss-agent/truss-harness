import type { ChatDisplayLine, ChatMessage } from "./types.js";

export function truncate(value: string, length: number): string {
  return value.length <= length
    ? value
    : `${value.slice(0, Math.max(0, length - 3))}...`;
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

export function visibleLines<T>(
  items: readonly T[],
  count: number,
  offset: number,
): readonly T[] {
  const end = Math.max(
    0,
    items.length - clamp(offset, 0, Math.max(0, items.length - count)),
  );
  return items.slice(Math.max(0, end - count), end);
}

export function estimateTokens(value: string): number {
  const trimmed = value.trim();
  return trimmed ? Math.ceil(trimmed.length / 4) : 0;
}

export function formatTokenCount(value: number): string {
  if (value < 1_000) return String(Math.round(value));
  return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k`;
}

export function wrapText(value: string, width: number): string[] {
  const result: string[] = [];
  for (const sourceLine of value.split(/\r?\n/)) {
    let remaining = sourceLine || " ";
    while (remaining.length > width) {
      const breakAt = Math.max(1, remaining.lastIndexOf(" ", width));
      result.push(remaining.slice(0, breakAt).trimEnd());
      remaining = remaining.slice(breakAt).trimStart();
    }
    result.push(remaining);
  }
  return result;
}

export function plainChatText(value: string): string {
  let inCodeBlock = false;
  return value
    .split(/\r?\n/)
    .flatMap((sourceLine) => {
      if (/^\s*```/.test(sourceLine)) {
        inCodeBlock = !inCodeBlock;
        return [];
      }
      if (inCodeBlock) return [`  ${sourceLine}`];
      const line = sourceLine
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/^\s*>\s?/, "")
        .replace(/^\s*[-*+]\s+/, "- ")
        .replace(/^\s*\d+[.)]\s+/, "- ")
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/(\*\*|__|\*|_|~~)/g, "");
      return /^\s*[-:|]+\s*$/.test(line) ? [] : [line];
    })
    .join("\n");
}

export function chatDisplayLines(
  messages: readonly ChatMessage[],
  busy: boolean,
  width: number,
): readonly ChatDisplayLine[] {
  return messages.flatMap((message, messageIndex) => {
    const content = message.content
      ? message.role === "assistant"
        ? plainChatText(message.content)
        : message.content
      : busy && message.role === "assistant"
        ? "Thinking..."
        : "";
    return [
      {
        key: `${messageIndex}:header`,
        role: message.role,
        text: message.role === "user" ? "YOU" : "AGENT",
        header: true,
      },
      ...wrapText(content, width).map((text, lineIndex) => ({
        key: `${messageIndex}:${lineIndex}`,
        role: message.role,
        text,
        header: false,
      })),
    ];
  });
}

export function configuredContextWindow(
  value = process.env.TRUSS_HARNESS_CONTEXT_WINDOW,
): number {
  const configured = Number.parseInt(value ?? "8192", 10);
  return Number.isFinite(configured)
    ? Math.max(512, Math.min(1_000_000, configured))
    : 8_192;
}
