import { mkdir, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveConfiguration } from "./config.js";

describe("resolveConfiguration", () => {
  it("merges environment, user profiles, workspace profiles, and explicit overrides in precedence order", async () => {
    const root = join(process.cwd(), ".test-workspaces", randomUUID());
    const paths = { user: join(root, "user.json"), workspace: join(root, "workspace.json") };
    await mkdir(root, { recursive: true });
    try {
      await writeFile(paths.user, JSON.stringify({
        defaultProfile: "local",
        profiles: {
          local: { provider: "ollama", baseUrl: "http://user:11434", model: "user-model", permission: "ask", tuiTheme: "sage" }
        }
      }));
      await writeFile(paths.workspace, JSON.stringify({
        profiles: {
          local: { baseUrl: "http://workspace:11434", model: "workspace-model", mode: "edit", permission: "auto-read", internetAccess: true }
        }
      }));

      const resolved = await resolveConfiguration({
        workspaceRoot: root,
        paths,
        environment: { TRUSS_HARNESS_MODEL: "environment-model", TRUSS_HARNESS_AGENT_MODE: "plan" },
        overrides: { model: "flag-model", permission: "auto-all" }
      });

      expect(resolved).toMatchObject({
        provider: "ollama",
        baseUrl: "http://workspace:11434",
        model: "flag-model",
        mode: "edit",
        permission: "auto-all",
        internetAccess: true,
        profile: "local",
        tuiTheme: "sage"
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("accepts a valid terminal theme from the environment", async () => {
    const root = join(process.cwd(), ".test-workspaces", randomUUID());
    const paths = { user: join(root, "user.json"), workspace: join(root, "workspace.json") };
    await mkdir(root, { recursive: true });
    try {
      await writeFile(paths.user, JSON.stringify({ model: "test-model" }));
      const resolved = await resolveConfiguration({ workspaceRoot: root, paths, environment: { TRUSS_HARNESS_TUI_THEME: "dusk" } });
      expect(resolved.tuiTheme).toBe("dusk");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("resolves a cloud provider endpoint and its conventional BYOK environment variable", async () => {
    const root = join(process.cwd(), ".test-workspaces", randomUUID());
    const paths = { user: join(root, "user.json"), workspace: join(root, "workspace.json") };
    await mkdir(root, { recursive: true });
    try {
      await writeFile(paths.user, JSON.stringify({ provider: "groq", model: "llama-test" }));
      const resolved = await resolveConfiguration({ workspaceRoot: root, paths, environment: { GROQ_API_KEY: "private-key" } });

      expect(resolved).toMatchObject({
        provider: "groq",
        baseUrl: "https://api.groq.com/openai/v1",
        model: "llama-test",
        apiKey: "private-key"
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("ignores workspace MCP commands until the user explicitly trusts them", async () => {
    const root = join(process.cwd(), ".test-workspaces", randomUUID());
    const paths = { user: join(root, "user.json"), workspace: join(root, "workspace.json") };
    await mkdir(root, { recursive: true });
    try {
      await writeFile(paths.user, JSON.stringify({
        model: "test-model",
        mcpServers: { user: { command: "user-server" } }
      }));
      await writeFile(paths.workspace, JSON.stringify({
        mcpServers: { workspace: { command: "workspace-server" } }
      }));

      const untrusted = await resolveConfiguration({
        workspaceRoot: root,
        paths,
        environment: {}
      });
      expect(untrusted.mcpServers).toEqual({
        user: { command: "user-server", enabled: true, readOnly: false }
      });

      await writeFile(paths.user, JSON.stringify({
        model: "test-model",
        allowWorkspaceMcpServers: true,
        mcpServers: { user: { command: "user-server" } }
      }));
      const trusted = await resolveConfiguration({
        workspaceRoot: root,
        paths,
        environment: {}
      });
      expect(trusted.mcpServers).toEqual({
        workspace: { command: "workspace-server", enabled: true, readOnly: false }
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
