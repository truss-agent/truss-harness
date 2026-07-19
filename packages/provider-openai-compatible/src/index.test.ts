import { describe, expect, it } from "vitest";
import { OllamaProvider, OpenAICompatibleProvider, detectActiveLocalModel, detectLocalContextWindow, detectLocalEndpoints, generateLocalText, listLocalModels, normalizeLocalBaseUrl } from "./index.js";

describe("OpenAICompatibleProvider", () => {
  it("repairs LM Studio's root endpoint without changing custom compatible endpoints", () => {
    expect(normalizeLocalBaseUrl("openai-compatible", "http://127.0.0.1:1234")).toBe("http://127.0.0.1:1234/v1");
    expect(normalizeLocalBaseUrl("openai-compatible", "http://127.0.0.1:1234/v1")).toBe("http://127.0.0.1:1234/v1");
    expect(normalizeLocalBaseUrl("openai-compatible", "http://localhost:8080/api")).toBe("http://localhost:8080/api");
  });

  it("uses LM Studio's v1 chat route when an older root endpoint is configured", async () => {
    let requestUrl = "";
    const provider = new OpenAICompatibleProvider({
      baseUrl: "http://127.0.0.1:1234",
      model: "local-model",
      fetch: async (url) => {
        requestUrl = String(url);
        return new Response('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
      }
    });

    for await (const _event of provider.stream({ messages: [{ role: "user", content: "hi" }], tools: [] })) { /* Consume stream. */ }
    expect(requestUrl).toBe("http://127.0.0.1:1234/v1/chat/completions");
  });

  it("converts streaming content and tool-call fragments into runtime events", async () => {
    const body = [
      'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"world"}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_file","arguments":"{\\"path\\":\\""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"README.md\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
      "data: [DONE]\n\n"
    ].join("");
    const provider = new OpenAICompatibleProvider({
      baseUrl: "http://localhost:11434/v1",
      model: "test",
      fetch: async () => new Response(body, { headers: { "content-type": "text/event-stream" } })
    });

    const events = [];
    for await (const event of provider.stream({ messages: [{ role: "user", content: "hi" }], tools: [] })) events.push(event);

    expect(events).toEqual([
      { type: "text_delta", text: "Hello " },
      { type: "text_delta", text: "world" },
      { type: "tool_call", id: "call_1", name: "read_file", input: { path: "README.md" } },
      { type: "finish", reason: "tool_calls" }
    ]);
  });

  it("accepts a clean local-server close without an OpenAI [DONE] marker", async () => {
    const body = [
      'data: {"choices":[{"delta":{"content":"feat: add local commit messages"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}'
    ].join("");
    const provider = new OpenAICompatibleProvider({
      baseUrl: "http://localhost:1234/v1",
      model: "local-model",
      fetch: async () => new Response(body, { headers: { "content-type": "text/event-stream" } })
    });

    const events = [];
    for await (const event of provider.stream({ messages: [{ role: "user", content: "hi" }], tools: [] })) events.push(event);

    expect(events).toEqual([
      { type: "text_delta", text: "feat: add local commit messages" },
      { type: "finish", reason: "stop" }
    ]);
  });
});

describe("local model discovery", () => {
  it("discovers Ollama and OpenAI-compatible model lists", async () => {
    const ollama = { id: "ollama", label: "Ollama", kind: "ollama" as const, baseUrl: "http://ollama" };
    const lmStudio = { id: "lm-studio", label: "LM Studio", kind: "openai-compatible" as const, baseUrl: "http://lm-studio/v1" };
    const fetch = async (url: string | URL | Request) => new Response(
      String(url).includes("ollama") ? JSON.stringify({ models: [{ name: "qwen3:8b" }] }) : JSON.stringify({ data: [{ id: "local-model" }] })
    );

    await expect(listLocalModels(ollama, { fetch })).resolves.toEqual([{ id: "qwen3:8b", name: "qwen3:8b" }]);
    await expect(detectLocalEndpoints({ fetch, endpoints: [ollama, lmStudio] })).resolves.toEqual([ollama, lmStudio]);
  });

  it("prefers the Ollama model currently reported as running", async () => {
    const ollama = { id: "ollama", label: "Ollama", kind: "ollama" as const, baseUrl: "http://ollama" };
    const fetch = async (url: string | URL | Request) => new Response(
      String(url).endsWith("/api/ps") ? JSON.stringify({ models: [{ name: "qwen3:8b" }] }) : JSON.stringify({ models: [{ name: "other:latest" }] })
    );

    await expect(detectActiveLocalModel({ fetch, endpoints: [ollama] })).resolves.toEqual({
      endpoint: ollama,
      model: { id: "qwen3:8b", name: "qwen3:8b" },
      active: true
    });
  });
});

describe("local text generation", () => {
  it("reads an OpenAI-compatible non-streaming response", async () => {
    const text = await generateLocalText(
      { kind: "openai-compatible", baseUrl: "http://localhost:1234/v1", model: "local-model" },
      "Write a commit message.",
      { fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: "feat: add commit message generation" } }] })) }
    );

    expect(text).toBe("feat: add commit message generation");
  });

  it("reads an Ollama non-streaming response", async () => {
    const text = await generateLocalText(
      { kind: "ollama", baseUrl: "http://localhost:11434", model: "local-model" },
      "Write a commit message.",
      { fetch: async () => new Response(JSON.stringify({ message: { content: "fix: support local responses" } })) }
    );

    expect(text).toBe("fix: support local responses");
  });
});

describe("local context discovery", () => {
  it("reads a loaded LM Studio instance context length", async () => {
    const endpoint = { id: "lm-studio", label: "LM Studio", kind: "openai-compatible" as const, baseUrl: "http://localhost:1234/v1" };
    const contextWindow = await detectLocalContextWindow(endpoint, "local-model", {
      fetch: async () => new Response(JSON.stringify({ data: [{ id: "local-model", loaded_instances: [{ id: "local-model", config: { context_length: 32768 } }] }] }))
    });

    expect(contextWindow).toBe(32768);
  });
});

describe("OllamaProvider", () => {
  it("maps native Ollama tool calls into runtime tool events", async () => {
    const body = [
      '{"message":{"role":"assistant","content":"Inspecting files. "},"done":false}\n',
      '{"message":{"role":"assistant","tool_calls":[{"function":{"name":"list_directory","arguments":{"path":"."}}}]},"done":false}\n',
      '{"message":{"role":"assistant","content":""},"done":true,"done_reason":"stop"}\n'
    ].join("");
    const provider = new OllamaProvider({
      baseUrl: "http://localhost:11434",
      model: "qwen3",
      fetch: async () => new Response(body)
    });
    const events = [];
    for await (const event of provider.stream({ messages: [{ role: "user", content: "list files" }], tools: [] })) events.push(event);

    expect(events).toEqual([
      { type: "text_delta", text: "Inspecting files. " },
      { type: "tool_call", id: "ollama-1", name: "list_directory", input: { path: "." } },
      { type: "finish", reason: "stop" }
    ]);
  });
});
