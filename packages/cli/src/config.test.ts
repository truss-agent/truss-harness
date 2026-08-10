import { mkdir, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  listConfigurationProfiles,
  providerAccountEnvironmentVariable,
  resolveConfiguration,
} from "./config.js";

describe("resolveConfiguration", () => {
  it("gives explicit overrides and client environment settings precedence over persisted profiles", async () => {
    const root = join(process.cwd(), ".test-workspaces", randomUUID());
    const paths = {
      user: join(root, "user.json"),
      workspace: join(root, "workspace.json"),
    };
    await mkdir(root, { recursive: true });
    try {
      await writeFile(
        paths.user,
        JSON.stringify({
          defaultProfile: "local",
          profiles: {
            local: {
              provider: "ollama",
              baseUrl: "http://user:11434",
              model: "user-model",
              permission: "ask",
              tuiTheme: "sage",
            },
          },
        }),
      );
      await writeFile(
        paths.workspace,
        JSON.stringify({
          profiles: {
            local: {
              baseUrl: "http://workspace:11434",
              model: "workspace-model",
              mode: "edit",
              permission: "auto-read",
              internetAccess: true,
            },
          },
        }),
      );

      const resolved = await resolveConfiguration({
        workspaceRoot: root,
        paths,
        environment: {
          TRUSS_HARNESS_MODEL: "environment-model",
          TRUSS_HARNESS_AGENT_MODE: "plan",
        },
        overrides: { model: "flag-model", permission: "auto-all" },
      });

      expect(resolved).toMatchObject({
        provider: "ollama",
        baseUrl: "http://workspace:11434",
        model: "flag-model",
        mode: "plan",
        permission: "auto-all",
        internetAccess: true,
        profile: "local",
        tuiTheme: "sage",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("accepts a valid terminal theme from the environment", async () => {
    const root = join(process.cwd(), ".test-workspaces", randomUUID());
    const paths = {
      user: join(root, "user.json"),
      workspace: join(root, "workspace.json"),
    };
    await mkdir(root, { recursive: true });
    try {
      await writeFile(paths.user, JSON.stringify({ model: "test-model" }));
      const resolved = await resolveConfiguration({
        workspaceRoot: root,
        paths,
        environment: { TRUSS_HARNESS_TUI_THEME: "dusk" },
      });
      expect(resolved.tuiTheme).toBe("dusk");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not let a persisted local profile override a client-injected cloud runtime", async () => {
    const root = join(process.cwd(), ".test-workspaces", randomUUID());
    const paths = {
      user: join(root, "user.json"),
      workspace: join(root, "workspace.json"),
    };
    await mkdir(root, { recursive: true });
    try {
      await writeFile(
        paths.user,
        JSON.stringify({
          provider: "ollama",
          baseUrl: "http://127.0.0.1:11434",
          model: "stale-local-model",
        }),
      );

      const resolved = await resolveConfiguration({
        workspaceRoot: root,
        paths,
        environment: {
          TRUSS_HARNESS_PROVIDER: "openrouter",
          TRUSS_HARNESS_BASE_URL: "https://openrouter.ai/api/v1",
          TRUSS_HARNESS_MODEL: "openai/gpt-4.1-mini",
          TRUSS_HARNESS_API_KEY: "test-key",
        },
      });

      expect(resolved).toMatchObject({
        provider: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        model: "openai/gpt-4.1-mini",
        apiKey: "test-key",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("resolves a cloud provider endpoint and its conventional BYOK environment variable", async () => {
    const root = join(process.cwd(), ".test-workspaces", randomUUID());
    const paths = {
      user: join(root, "user.json"),
      workspace: join(root, "workspace.json"),
    };
    await mkdir(root, { recursive: true });
    try {
      await writeFile(
        paths.user,
        JSON.stringify({ provider: "groq", model: "llama-test" }),
      );
      const resolved = await resolveConfiguration({
        workspaceRoot: root,
        paths,
        environment: { GROQ_API_KEY: "private-key" },
      });

      expect(resolved).toMatchObject({
        provider: "groq",
        baseUrl: "https://api.groq.com/openai/v1",
        model: "llama-test",
        apiKey: "private-key",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("resolves Xiaomi MiMo and Ollama Cloud as separate credentialed providers", async () => {
    const root = join(process.cwd(), ".test-workspaces", randomUUID());
    const paths = {
      user: join(root, "user.json"),
      workspace: join(root, "workspace.json"),
    };
    await mkdir(root, { recursive: true });
    try {
      await writeFile(
        paths.user,
        JSON.stringify({
          profiles: {
            mimo: { provider: "xiaomi-mimo", model: "mimo-v2.5" },
            ollamaCloud: { provider: "ollama-cloud", model: "qwen3-coder:480b" },
          },
        }),
      );

      await expect(
        resolveConfiguration({
          workspaceRoot: root,
          paths,
          environment: { MIMO_API_KEY: "mimo-key" },
          overrides: { profile: "mimo" },
        }),
      ).resolves.toMatchObject({
        provider: "xiaomi-mimo",
        baseUrl: "https://api.xiaomimimo.com/v1",
        apiKey: "mimo-key",
      });
      await expect(
        resolveConfiguration({
          workspaceRoot: root,
          paths,
          environment: { OLLAMA_API_KEY: "ollama-key" },
          overrides: { profile: "ollamaCloud" },
        }),
      ).resolves.toMatchObject({
        provider: "ollama-cloud",
        baseUrl: "https://ollama.com",
        apiKey: "ollama-key",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("ignores workspace MCP commands until the user explicitly trusts them", async () => {
    const root = join(process.cwd(), ".test-workspaces", randomUUID());
    const paths = {
      user: join(root, "user.json"),
      workspace: join(root, "workspace.json"),
    };
    await mkdir(root, { recursive: true });
    try {
      await writeFile(
        paths.user,
        JSON.stringify({
          model: "test-model",
          mcpServers: { user: { command: "user-server" } },
        }),
      );
      await writeFile(
        paths.workspace,
        JSON.stringify({
          mcpServers: { workspace: { command: "workspace-server" } },
        }),
      );

      const untrusted = await resolveConfiguration({
        workspaceRoot: root,
        paths,
        environment: {},
      });
      expect(untrusted.mcpServers).toEqual({
        user: { command: "user-server", enabled: true, readOnly: false },
      });

      await writeFile(
        paths.user,
        JSON.stringify({
          model: "test-model",
          allowWorkspaceMcpServers: true,
          mcpServers: { user: { command: "user-server" } },
        }),
      );
      const trusted = await resolveConfiguration({
        workspaceRoot: root,
        paths,
        environment: {},
      });
      expect(trusted.mcpServers).toEqual({
        workspace: {
          command: "workspace-server",
          enabled: true,
          readOnly: false,
        },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("selects an account-scoped key before the provider fallback", async () => {
    const root = join(process.cwd(), ".test-workspaces", randomUUID());
    const paths = {
      user: join(root, "user.json"),
      workspace: join(root, "workspace.json"),
    };
    await mkdir(root, { recursive: true });
    try {
      await writeFile(
        paths.user,
        JSON.stringify({
          provider: "openrouter",
          model: "provider/model",
          credentialRef: "work/team",
        }),
      );
      const resolved = await resolveConfiguration({
        workspaceRoot: root,
        paths,
        environment: {
          OPENROUTER_API_KEY: "fallback-key",
          [providerAccountEnvironmentVariable("work/team")]: "account-key",
        },
      });

      expect(resolved.credentialRef).toBe("work/team");
      expect(resolved.apiKey).toBe("account-key");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("listConfigurationProfiles", () => {
  it("returns merged credential-safe profile summaries", async () => {
    const root = join(process.cwd(), ".test-workspaces", randomUUID());
    const paths = {
      user: join(root, "user.json"),
      workspace: join(root, "workspace.json"),
    };
    await mkdir(root, { recursive: true });
    try {
      await writeFile(
        paths.user,
        JSON.stringify({
          defaultProfile: "cloud",
          profiles: {
            cloud: {
              provider: "openrouter",
              model: "provider/model",
              mode: "chat",
              apiKeyEnv: "OPENROUTER_API_KEY",
            },
            local: { provider: "ollama", model: "qwen3:8b" },
          },
        }),
      );
      await writeFile(
        paths.workspace,
        JSON.stringify({
          profiles: {
            cloud: { mode: "edit", permission: "ask" },
          },
        }),
      );

      await expect(
        listConfigurationProfiles({
          workspaceRoot: root,
          paths,
          environment: { OPENROUTER_API_KEY: "never-return-this" },
        }),
      ).resolves.toEqual([
        {
          name: "cloud",
          selected: true,
          provider: "openrouter",
          model: "provider/model",
          mode: "edit",
          permission: "ask",
        },
        {
          name: "local",
          selected: false,
          provider: "ollama",
          model: "qwen3:8b",
        },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
