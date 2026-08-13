import { describe, expect, it } from "vitest";
import { appendChunk, parseToolCalls, tokenUsage } from "./wire.js";

describe("OpenAI-compatible wire helpers", () => {
  it("assembles fragmented tool calls in provider order", () => {
    const calls = new Map();
    appendChunk(calls, {
      delta: {
        tool_calls: [
          {
            index: 0,
            id: "call-1",
            function: { name: "read_file", arguments: '{"path":"' },
          },
        ],
      },
    });
    appendChunk(calls, {
      delta: {
        tool_calls: [{ index: 0, function: { arguments: 'README.md"}' } }],
      },
    });

    expect(parseToolCalls(calls)).toEqual([
      {
        id: "call-1",
        name: "read_file",
        input: { path: "README.md" },
      },
    ]);
  });

  it("normalizes OpenAI and Ollama usage shapes", () => {
    expect(tokenUsage({ prompt_tokens: 8, completion_tokens: 3 })).toEqual({
      inputTokens: 8,
      outputTokens: 3,
      totalTokens: 11,
    });
    expect(tokenUsage({ prompt_eval_count: 5, eval_count: 2 })).toEqual({
      inputTokens: 5,
      outputTokens: 2,
      totalTokens: 7,
    });
  });
});
