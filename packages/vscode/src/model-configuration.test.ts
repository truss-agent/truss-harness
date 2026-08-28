import { describe, expect, it } from "vitest";
import {
  discoveredModel,
  normalizeConfiguration,
  normalizeMcpServers,
} from "./model-configuration.js";

describe("VS Code model configuration", () => {
  it("normalizes local settings and optional agent behavior", () => {
    expect(
      normalizeConfiguration({
        provider: "ollama",
        baseUrl: "http://localhost:11434/v1/",
        model: "qwen3-coder",
        mode: "edit",
        permission: "auto-read",
        contextWindow: 32_768.9,
        internetAccess: true,
        mcpServers: {},
      }),
    ).toMatchObject({
      provider: "ollama",
      baseUrl: "http://localhost:11434/v1",
      model: "qwen3-coder",
      mode: "edit",
      permission: "auto-read",
      contextWindow: 32_768,
      internetAccess: true,
    });
  });

  it("uses the provider-owned endpoint for cloud configurations", () => {
    const configuration = normalizeConfiguration({
      provider: "openrouter",
      baseUrl: "https://wrong.example/v1",
      model: "openai/gpt-4.1-mini",
      credentialAccountId: " account-1 ",
    });
    expect(configuration.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(configuration.credentialAccountId).toBe("account-1");
  });

  it("preserves the enabled master prompt template", () => {
    expect(
      normalizeConfiguration({
        provider: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        model: "openai/gpt-4.1-mini",
        masterPrompt: {
          enabled: true,
          template: "<workspace>{{workspace.root}}</workspace>",
        },
      }).masterPrompt,
    ).toEqual({
      enabled: true,
      template: "<workspace>{{workspace.root}}</workspace>",
    });
  });

  it("normalizes discovered model metadata and OpenRouter pricing", () => {
    expect(
      discoveredModel(
        {
          id: "test/model",
          context_length: 128_000,
          pricing: { prompt: 0.000002, completion: 0.000006 },
        },
        "openrouter",
      ),
    ).toEqual({
      id: "test/model",
      contextWindow: 128_000,
      inputCostPerMillion: 2,
      outputCostPerMillion: 6,
    });
  });

  it("drops malformed MCP entries without changing valid configuration", () => {
    expect(
      normalizeMcpServers({
        filesystem: {
          command: "npx",
          args: ["-y", "server"],
          env: { MODE: "readonly" },
          readOnly: true,
        },
        invalid: { command: "", args: [7] },
      }),
    ).toEqual({
      filesystem: {
        command: "npx",
        args: ["-y", "server"],
        cwd: undefined,
        env: { MODE: "readonly" },
        enabled: true,
        readOnly: true,
      },
    });
  });
});
