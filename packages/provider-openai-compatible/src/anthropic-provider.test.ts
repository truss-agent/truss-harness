import { describe, expect, it } from "vitest";
import { AnthropicProvider } from "./anthropic-provider.js";
import { createCloudModelProvider } from "./factories.js";

function streamResponse(body: string): Response {
  return new Response(body, {
    headers: { "content-type": "text/event-stream" },
  });
}

describe("AnthropicProvider", () => {
  it("routes the cloud factory to the native adapter", async () => {
    let requestUrl = "";
    const provider = createCloudModelProvider({
      provider: "anthropic",
      model: "claude-test",
      credential: {
        id: "anthropic-key",
        async resolve() {
          return { kind: "bearer", token: "sk-ant-api-test" };
        },
      },
      fetch: async (input) => {
        requestUrl = String(input);
        return new Response(
          `data: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text" } })}\n\n` +
            `data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } })}\n\n` +
            `data: ${JSON.stringify({ type: "message_stop" })}\n\n`,
          { headers: { "content-type": "text/event-stream" } },
        );
      },
    });

    for await (const _event of provider.stream({
      messages: [{ role: "user", content: "hi" }],
      tools: [],
    })) {
      // consume
    }
    expect(provider.id).toBe("anthropic");
    expect(requestUrl).toBe("https://api.anthropic.com/v1/messages");
  });

  it("sends native Messages requests and maps text, tools, and usage", async () => {
    let requestUrl = "";
    let request: Record<string, unknown> | undefined;
    let requestHeaders: Headers | undefined;
    const body = [
      `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 14 } } })}`,
      `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}`,
      `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } })}`,
      `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}`,
      `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_1", name: "read_file", input: {} } })}`,
      `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"path":"README.md"}' } })}`,
      `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 1 })}`,
      `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 9 } })}`,
      `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}`,
    ].join("\n\n");
    const provider = new AnthropicProvider({
      baseUrl: "https://api.anthropic.com/v1/",
      model: "claude-test",
      apiKey: "sk-ant-api-test",
      maxTokens: 4096,
      fetch: async (input, init) => {
        requestUrl = String(input);
        request = JSON.parse(String(init?.body)) as Record<string, unknown>;
        requestHeaders = new Headers(init?.headers);
        return streamResponse(body);
      },
    });

    const events = [];
    for await (const event of provider.stream({
      messages: [
        { role: "system", content: "Be concise." },
        { role: "user", content: "Read the file." },
      ],
      tools: [
        {
          name: "read_file",
          description: "Read a workspace file.",
          inputSchema: {
            type: "object",
            properties: { path: { type: "string" } },
          },
        },
      ],
    }))
      events.push(event);

    expect(requestUrl).toBe("https://api.anthropic.com/v1/messages");
    expect(requestHeaders?.get("x-api-key")).toBe("sk-ant-api-test");
    expect(requestHeaders?.has("authorization")).toBe(false);
    expect(requestHeaders?.get("anthropic-version")).toBe("2023-06-01");
    expect(request).toMatchObject({
      model: "claude-test",
      max_tokens: 4096,
      stream: true,
      system: "Be concise.",
    });
    expect(request?.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "Read the file." }] },
    ]);
    expect(request?.tools).toEqual([
      {
        name: "read_file",
        description: "Read a workspace file.",
        input_schema: {
          type: "object",
          properties: { path: { type: "string" } },
        },
      },
    ]);
    expect(events).toEqual([
      { type: "text_delta", text: "Hello" },
      {
        type: "tool_call",
        id: "toolu_1",
        name: "read_file",
        input: { path: "README.md" },
      },
      {
        type: "finish",
        reason: "tool_calls",
        usage: { inputTokens: 14, outputTokens: 9, totalTokens: 23 },
      },
    ]);
  });

  it("converts system history, tool results, and images into valid content blocks", async () => {
    let request: Record<string, unknown> | undefined;
    const provider = new AnthropicProvider({
      baseUrl: "https://api.anthropic.com/v1",
      model: "claude-test",
      credential: {
        id: "anthropic-oauth",
        async resolve() {
          return { kind: "bearer", token: "sk-ant-oat-test" };
        },
      },
      fetch: async (_input, init) => {
        request = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            content: [{ type: "text", text: "Done" }],
            stop_reason: "end_turn",
            usage: { input_tokens: 20, output_tokens: 3 },
          }),
          { headers: { "content-type": "application/json" } },
        );
      },
    });

    const events = [];
    for await (const event of provider.stream({
      messages: [
        { role: "system", content: "Use tools safely." },
        {
          role: "user",
          content: "Inspect this.",
          attachments: [
            {
              id: "image-1",
              kind: "image",
              name: "screen.png",
              mediaType: "image/png",
              data: "data:image/png;base64,AA==",
              size: 4,
            },
          ],
        },
        {
          role: "assistant",
          content: "I will inspect it.",
          toolCalls: [
            { id: "toolu_1", name: "read_file", input: { path: "a.txt" } },
          ],
        },
        {
          role: "tool",
          toolCallId: "toolu_1",
          name: "read_file",
          content: "contents",
        },
      ],
      tools: [],
    }))
      events.push(event);

    const messages = request?.messages as readonly Record<string, unknown>[];
    expect(request).toMatchObject({ system: "Use tools safely." });
    expect(messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "Inspect this." },
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: "AA==" },
          },
        ],
      },
      {
        role: "assistant",
        content: [
          { type: "text", text: "I will inspect it." },
          {
            type: "tool_use",
            id: "toolu_1",
            name: "read_file",
            input: { path: "a.txt" },
          },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "toolu_1", content: "contents" },
        ],
      },
    ]);
    expect(events).toEqual([
      { type: "text_delta", text: "Done" },
      {
        type: "finish",
        reason: "stop",
        usage: { inputTokens: 20, outputTokens: 3, totalTokens: 23 },
      },
    ]);
  });

  it("refreshes credentials after an authentication failure", async () => {
    let token = "sk-ant-old";
    let refreshes = 0;
    const authorizations: string[] = [];
    const provider = new AnthropicProvider({
      baseUrl: "https://api.anthropic.com/v1",
      model: "claude-test",
      credential: {
        id: "refreshable",
        async resolve() {
          return { kind: "bearer", token };
        },
        async refresh() {
          refreshes += 1;
          token = "sk-ant-oat-new";
        },
      },
      fetch: async (_input, init) => {
        const headers = new Headers(init?.headers);
        authorizations.push(
          headers.get("x-api-key") ?? headers.get("authorization") ?? "",
        );
        return authorizations.length === 1
          ? new Response("unauthorized", { status: 401 })
          : streamResponse(
              `data: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text" } })}\n\n` +
                `data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } })}\n\n` +
                `data: ${JSON.stringify({ type: "message_stop" })}\n\n`,
            );
      },
    });

    for await (const _event of provider.stream({
      messages: [{ role: "user", content: "hi" }],
      tools: [],
    })) {
      // consume
    }
    expect(authorizations).toEqual(["sk-ant-old", "Bearer sk-ant-oat-new"]);
    expect(refreshes).toBe(1);
  });
});
