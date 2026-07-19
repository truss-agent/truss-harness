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
          local: { provider: "ollama", baseUrl: "http://user:11434", model: "user-model", permission: "ask" }
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
        profile: "local"
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
