import type { JsonObject, ToolCall, ToolResult } from "../contracts.js";

function objectInput(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function parseInput(value: unknown): {
  readonly input: JsonObject;
  readonly error?: string;
} {
  const object = objectInput(value);
  if (object) return { input: object };
  if (typeof value !== "string") {
    return {
      input: {},
      error: "Tool arguments must be a JSON object.",
    };
  }
  if (!value.trim()) return { input: {} };
  try {
    const parsed = objectInput(JSON.parse(value));
    return parsed
      ? { input: parsed }
      : { input: {}, error: "Tool arguments must be a JSON object." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid JSON";
    return {
      input: {},
      error: `Tool arguments could not be parsed: ${message}`,
    };
  }
}

/**
 * Narrows untrusted provider events into the runtime's stable tool-call shape.
 * Some OpenAI-compatible servers return a JSON string for arguments despite a
 * tool schema, while malformed values must become a recoverable tool result.
 */
export function normalizeToolCall(call: ToolCall): ToolCall {
  const candidate = call as unknown as Record<string, unknown>;
  const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
  const id =
    typeof candidate.id === "string" && candidate.id.trim()
      ? candidate.id
      : "invalid-tool-call";
  const parsed = parseInput(candidate.input);
  const existingError =
    typeof candidate.parseError === "string" && candidate.parseError.trim()
      ? candidate.parseError.trim()
      : undefined;
  return {
    id,
    name: name || "unknown_tool",
    input: parsed.input,
    ...(existingError || parsed.error
      ? { parseError: existingError ?? parsed.error }
      : {}),
  };
}

/** Keep tool feedback compatible with strict providers that reject empty text. */
export function normalizeToolResult(value: unknown): ToolResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      content: "Tool execution failed: the tool returned an invalid result.",
      isError: true,
    };
  }
  const result = value as Partial<ToolResult>;
  if (typeof result.content !== "string") {
    return {
      content: "Tool execution failed: the tool returned no text content.",
      isError: true,
    };
  }
  return {
    content: result.content.trim()
      ? result.content
      : "Tool completed without output.",
    ...(result.isError ? { isError: true } : {}),
  };
}
