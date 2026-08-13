import { describe, expect, it } from "vitest";
import type { DesktopConfiguration } from "../../shared.js";
import {
  buildProviderConnectionConfiguration,
  buildSettingsConfiguration,
  parseMcpConfigurations,
  preferredProviderAccount,
  SettingsController,
} from "./settings-controller.js";

const current: DesktopConfiguration = {
  provider: "ollama",
  baseUrl: "http://127.0.0.1:11434",
  model: "qwen",
  mode: "chat",
  permission: "ask",
  contextWindow: 8_192,
  internetAccess: false,
  autocomplete: { enabled: false },
  formatOnSave: false,
  mcpServers: {},
};

describe("settings configuration", () => {
  it("builds a cloud configuration with discovered model context", () => {
    const configuration = buildSettingsConfiguration({
      current,
      modelTab: "byok",
      localProvider: "ollama",
      localBaseUrl: "",
      localModel: "",
      cloudProvider: "openrouter",
      cloudBaseUrl: "https://openrouter.ai/api/v1",
      cloudModel: "openai/gpt-4.1-mini",
      credentialAccountId: "account-1",
      permission: "auto-read",
      contextWindow: "8192",
      selectedModel: {
        id: "openai/gpt-4.1-mini",
        contextWindow: 128_000,
      },
      internetAccess: true,
      autocompleteEnabled: true,
      autocompleteModel: "openai/gpt-4.1-mini",
      formatOnSave: true,
      mcpServers: {},
    });

    expect(configuration).toMatchObject({
      provider: "openrouter",
      model: "openai/gpt-4.1-mini",
      credentialAccountId: "account-1",
      permission: "auto-read",
      contextWindow: 128_000,
      modelContextWindow: 128_000,
      internetAccess: true,
    });
  });

  it("keeps connection tests free of unrelated draft settings", () => {
    expect(
      buildProviderConnectionConfiguration({
        current,
        modelTab: "local",
        localProvider: "openai-compatible",
        localBaseUrl: "http://127.0.0.1:1234/v1",
        localModel: "local-model",
        cloudProvider: "openrouter",
        cloudBaseUrl: "",
        cloudModel: "",
      }),
    ).toMatchObject({
      provider: "openai-compatible",
      model: "local-model",
      permission: "ask",
    });
  });

  it("parses only object-shaped MCP configuration", () => {
    expect(parseMcpConfigurations('{"filesystem":{"command":"npx"}}')).toEqual({
      filesystem: { command: "npx" },
    });
    expect(() => parseMcpConfigurations("[]")).toThrow(
      "MCP servers must be a JSON object.",
    );
  });

  it("selects preferred, current, then first provider accounts", () => {
    const accounts = [
      {
        id: "first",
        providerId: "openrouter" as const,
        label: "First",
        authMethod: "api-key" as const,
        status: "active" as const,
        createdAt: "2026-08-13T00:00:00.000Z",
        updatedAt: "2026-08-13T00:00:00.000Z",
      },
      {
        id: "preferred",
        providerId: "openrouter" as const,
        label: "Preferred",
        authMethod: "api-key" as const,
        status: "active" as const,
        createdAt: "2026-08-13T00:00:00.000Z",
        updatedAt: "2026-08-13T00:00:00.000Z",
      },
    ];

    expect(
      preferredProviderAccount(accounts, "openrouter", "preferred", "first")
        ?.id,
    ).toBe("preferred");
  });
});

describe("SettingsController", () => {
  it("owns account and MCP draft transitions", () => {
    const controller = new SettingsController();
    controller.selectProviderAccount("account-1");
    controller.createProviderAccount();
    controller.loadMcpDraft({ filesystem: { command: "npx" } });

    expect(controller.selectedProviderAccountId).toBeUndefined();
    expect(controller.creatingProviderAccount).toBe(true);
    expect(controller.mcpDraft).toEqual({ filesystem: { command: "npx" } });
  });

  it("owns MCP save, toggle, status, and removal transitions", () => {
    const controller = new SettingsController();
    controller.saveMcpServer("filesystem", {
      command: "npx",
      enabled: true,
    });
    controller.recordMcpStatus({
      name: "filesystem",
      state: "connected",
      toolCount: 2,
    });
    controller.toggleMcpServer("filesystem");

    expect(controller.mcpDraft.filesystem?.enabled).toBe(false);
    expect(controller.testedMcpStatuses.has("filesystem")).toBe(false);

    controller.removeMcpServer("filesystem");
    expect(controller.mcpDraft).toEqual({});
  });
});
