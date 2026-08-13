import { describe, expect, it } from "vitest";
import {
  compactCommitDiff,
  GitService,
  normalizeCommitMessage,
} from "./git-service.js";

describe("GitService", () => {
  it("parses status output and exposes the first push remote", async () => {
    const calls: string[][] = [];
    const service = new GitService(
      () => "/workspace",
      (path) => `/workspace/${path}`,
      async (_command, args) => {
        calls.push([...args]);
        if (args[0] === "status")
          return {
            stdout:
              "## feature...origin/feature [ahead 2, behind 1]\n M src/a.ts\n",
            stderr: "",
          };
        if (args[0] === "remote" && args.length === 1)
          return { stdout: "origin\n", stderr: "" };
        return { stdout: "git@github.com:owner/repo.git\n", stderr: "" };
      },
      () => undefined,
      async () => "",
    );

    expect(await service.status()).toEqual({
      available: true,
      branch: "feature",
      ahead: 2,
      behind: 1,
      files: [{ path: "src/a.ts", indexStatus: " ", workTreeStatus: "M" }],
      pushRemote: "origin",
    });
    expect(calls).toContainEqual(["remote", "get-url", "--push", "origin"]);
  });

  it("normalizes fenced messages and prioritizes source diffs when compacting", () => {
    const fence = String.fromCharCode(96).repeat(3);
    expect(
      normalizeCommitMessage(`${fence}gitcommit\nfix: do the thing\n${fence}`),
    ).toBe("fix: do the thing");
    const generated = `diff --git a/package-lock.json b/package-lock.json\n${"x".repeat(30_000)}\n`;
    const source = `diff --git a/src/a.ts b/src/a.ts\n${"y".repeat(10_000)}`;
    const compacted = compactCommitDiff(generated + source, 8_000);

    expect(compacted).toContain("diff --git a/src/a.ts");
    expect(compacted.length).toBeLessThan(generated.length + source.length);
  });

  it("delegates commit generation for cloud configurations", async () => {
    const generated: Array<{
      readonly provider: string;
      readonly prompt: string;
    }> = [];
    const service = new GitService(
      () => "/workspace",
      (path) => `/workspace/${path}`,
      async (_command, args) => ({
        stdout: args[0] === "diff" ? "diff --git a/a.ts b/a.ts\n+change" : "",
        stderr: "",
      }),
      () => ({
        provider: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        model: "openai/gpt-4.1-mini",
        credentialAccountId: "openrouter-personal",
        mode: "chat",
        permission: "ask",
        contextWindow: 32_000,
        internetAccess: false,
        mcpServers: {},
      }),
      async (configuration, prompt) => {
        generated.push({ provider: configuration.provider, prompt });
        return "```gitcommit\nrefactor(desktop): split renderer state\n```";
      },
    );

    await expect(service.generateCommitMessage()).resolves.toBe(
      "refactor(desktop): split renderer state",
    );
    expect(generated).toEqual([
      {
        provider: "openrouter",
        prompt: expect.stringContaining("diff --git a/a.ts b/a.ts"),
      },
    ]);
  });
});
