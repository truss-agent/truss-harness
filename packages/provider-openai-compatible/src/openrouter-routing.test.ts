import type { ModelStreamEvent, ToolDefinition } from "@truss-harness/runtime";
import { describe, expect, it } from "vitest";
import { OpenAICompatibleProvider } from "./openai-compatible-provider.js";

const readFileTool: ToolDefinition = {
  name: "read_file",
  description: "Read a workspace file.",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  },
};

async function requestPayload(options: {
  readonly id: string;
  readonly tools: readonly ToolDefinition[];
}): Promise<{
  readonly payload: Record<string, unknown>;
  readonly events: readonly ModelStreamEvent[];
}> {
  let payload: Record<string, unknown> = {};
  const provider = new OpenAICompatibleProvider({
    id: options.id,
    baseUrl: "https://example.com/v1",
    model: "test-model",
    fetch: async (_url, init) => {
      payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        [
          'data: {"choices":[{"delta":{"content":"cmd:default_api:read_file{path:script.js}"},"finish_reason":"stop"}]}',
          "data: [DONE]",
          "",
        ].join("\n\n"),
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  const events: ModelStreamEvent[] = [];
  for await (const event of provider.stream({
    messages: [{ role: "user", content: "Read script.js" }],
    tools: options.tools,
  }))
    events.push(event);
  return { payload, events };
}

describe("OpenRouter tool routing", () => {
  it("requires routed backends to support supplied tool parameters", async () => {
    const { payload, events } = await requestPayload({
      id: "openrouter",
      tools: [readFileTool],
    });

    expect(payload).toMatchObject({
      tool_choice: "auto",
      provider: { require_parameters: true },
      tools: [
        {
          type: "function",
          function: {
            name: "read_file",
            parameters: readFileTool.inputSchema,
          },
        },
      ],
    });
    expect(events).toEqual([
      {
        type: "text_delta",
        text: "cmd:default_api:read_file{path:script.js}",
      },
      { type: "finish", reason: "stop" },
    ]);
  });

  it("does not add tool-routing fields when an OpenRouter request has no tools", async () => {
    const { payload } = await requestPayload({ id: "openrouter", tools: [] });

    expect(payload).not.toHaveProperty("tools");
    expect(payload).not.toHaveProperty("tool_choice");
    expect(payload).not.toHaveProperty("provider");
  });

  it("does not add OpenRouter routing fields to other compatible providers", async () => {
    const { payload } = await requestPayload({
      id: "openai-compatible",
      tools: [readFileTool],
    });

    expect(payload).toHaveProperty("tools");
    expect(payload).not.toHaveProperty("tool_choice");
    expect(payload).not.toHaveProperty("provider");
  });
});
