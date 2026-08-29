import { describe, expect, it } from "vitest";
import {
  contextBudgetForConfiguration,
  modelInfoFromRecord,
  normalizeConfiguration,
  normalizeWorkspaceUiState,
  usableChatModels,
} from "./desktop-configuration.js";

describe("desktop configuration", () => {
  it("normalizes cloud configuration and uses published model context", () => {
    const configuration = normalizeConfiguration({
      provider: "openai",
      baseUrl: "https://wrong.example/v1",
      model: "gpt-5.6",
      mode: "chat",
      permission: "ask",
      contextWindow: 12_000,
      internetAccess: true,
      mcpServers: {},
    });

    expect(configuration.baseUrl).toBe("https://api.openai.com/v1");
    expect(configuration.model).toBe("gpt-5.6");
    expect(configuration.modelContextWindow).toBe(1_050_000);
    expect(contextBudgetForConfiguration(configuration)).toBe(1_050_000);
  });

  it("preserves a master prompt template without rewriting XML", () => {
    const configuration = normalizeConfiguration({
      provider: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      model: "qwen3-coder",
      mode: "chat",
      permission: "ask",
      contextWindow: 8_192,
      internetAccess: false,
      mcpServers: {},
      masterPrompt: {
        enabled: true,
        template: "<workspace>{{workspace.name}}</workspace>",
      },
    });

    expect(configuration.masterPrompt).toEqual({
      enabled: true,
      template: "<workspace>{{workspace.name}}</workspace>",
    });
  });

  it("normalizes persisted editor state without retaining invalid entries", () => {
    expect(
      normalizeWorkspaceUiState({
        expandedDirectories: ["src", 42],
        openEditors: [
          { path: "src/index.ts", mode: "file", scrollTop: -10 },
          { path: "bad", mode: "preview" },
        ],
        activeFile: "src/index.ts",
        fileTreeScrollTop: Number.NaN,
      }),
    ).toEqual({
      expandedDirectories: ["src"],
      openEditors: [{ path: "src/index.ts", mode: "file", scrollTop: 0 }],
      activeFile: "src/index.ts",
      fileTreeScrollTop: 0,
    });
  });

  it("normalizes provider metadata and filters non-chat models", () => {
    const chat = modelInfoFromRecord(
      {
        id: "vendor/chat",
        context_length: 32_000,
        supported_parameters: ["tools"],
        pricing: { prompt: "0.000001", completion: "0.000002" },
      },
      "openrouter",
    );
    const embedding = modelInfoFromRecord(
      { id: "vendor/embedding", type: "embedding" },
      "openrouter",
    );

    expect(chat).toEqual({
      id: "vendor/chat",
      contextWindow: 32_000,
      inputCostPerMillion: 1,
      outputCostPerMillion: 2,
      supportsTools: true,
    });
    expect(chat).toBeDefined();
    expect(embedding).toBeDefined();
    if (!chat || !embedding) throw new Error("Expected normalized models.");
    expect(usableChatModels([chat, embedding])).toEqual([chat]);
  });
});
