import { describe, expect, it } from "vitest";
import type { ModelProvider, ModelStreamEvent } from "@truss-harness/runtime";
import { OllamaProvider } from "./ollama-provider.js";
import { OpenAICompatibleProvider } from "./openai-compatible-provider.js";
import { AnthropicProvider } from "./anthropic-provider.js";
async function collect(provider: ModelProvider) {
  const events: ModelStreamEvent[] = [];
  for await (const event of provider.stream({ messages: [], tools: [] }))
    events.push(event);
  return events;
}
describe("semantic stream completion", () => {
  it.each(["openai", "anthropic"])(
    "rejects nonterminal %s tool blocks at EOF",
    async (kind) => {
      const body =
        kind === "openai"
          ? `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call", function: { name: "write_file", arguments: '{"path":"unsafe"}' } }] } }] })}\n\n`
          : `data: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "call", name: "write_file", input: { path: "unsafe" } } })}\n\n`;
      const fetch = async () =>
        new Response(body, {
          headers: { "content-type": "text/event-stream" },
        });
      const provider =
        kind === "openai"
          ? new OpenAICompatibleProvider({
              baseUrl: "http://example.test",
              model: "test",
              fetch,
            })
          : new AnthropicProvider({
              baseUrl: "http://example.test",
              model: "test",
              fetch,
            });
      await expect(collect(provider)).rejects.toThrow(/ended|incomplete/i);
    },
  );
  it.each(['{"message":{"content":"partial"},"done":false}', '{"message":'])(
    "rejects genuinely incomplete Ollama response %s",
    async (body) => {
      const provider = new OllamaProvider({
        baseUrl: "http://example.test",
        model: "test",
        fetch: async () => new Response(body),
      });
      await expect(collect(provider)).rejects.toThrow();
    },
  );

  it.each(["openai", "anthropic"])(
    "rejects truncated %s text without success",
    async (kind) => {
      const fetch = async () =>
        new Response(
          kind === "openai"
            ? 'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'
            : 'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"partial"}}\n\n',
          { headers: { "content-type": "text/event-stream" } },
        );
      const provider =
        kind === "openai"
          ? new OpenAICompatibleProvider({
              baseUrl: "http://example.test",
              model: "test",
              fetch,
            })
          : new AnthropicProvider({
              baseUrl: "http://example.test",
              model: "test",
              fetch,
            });
      await expect(collect(provider)).rejects.toThrow(/ended|incomplete/i);
    },
  );
  it.each([true, false])(
    "processes Ollama final Unicode record with newline=%s at every byte boundary",
    async (newline) => {
      const bytes = new TextEncoder().encode(
        JSON.stringify({
          message: {
            content: "héllo 🌟",
            tool_calls: [
              { function: { name: "read", arguments: { path: "x" } } },
            ],
          },
          done: true,
        }) + (newline ? "\n" : ""),
      );
      for (let split = 1; split < bytes.length; split++) {
        const provider = new OllamaProvider({
          baseUrl: "http://example.test",
          model: "test",
          fetch: async () =>
            new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(bytes.slice(0, split));
                  controller.enqueue(bytes.slice(split));
                  controller.close();
                },
              }),
            ),
        });
        expect(await collect(provider)).toEqual([
          { type: "text_delta", text: "héllo 🌟" },
          {
            type: "tool_call",
            id: "ollama-1",
            name: "read",
            input: { path: "x" },
          },
          { type: "finish", reason: "stop" },
        ]);
      }
    },
  );
});
