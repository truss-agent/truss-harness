import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  agentRunHistoryPath,
  FileAgentProfileStore,
  FileAgentRunHistoryStore,
} from "./agents.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("FileAgentProfileStore", () => {
  it("persists provider bindings without credential values", async () => {
    const root = await mkdtemp(join(tmpdir(), "truss-agents-"));
    roots.push(root);
    const store = new FileAgentProfileStore(root);
    const created = await store.create({
      displayName: "Review",
      provider: {
        providerId: "llama-cpp",
        endpointUrl: "http://127.0.0.1:8080/v1",
        modelId: "coder",
        credentialRef: "configuration",
      },
      mode: "plan",
      approvalPolicy: "auto-read",
      internetAccess: false,
    });

    expect(await store.list()).toEqual([created]);
    expect((await store.get(created.id))?.provider.credentialRef).toBe(
      "configuration",
    );
    expect(await store.delete(created.id)).toBe(true);
    expect(await store.list()).toEqual([]);
  });
});

describe("FileAgentRunHistoryStore", () => {
  it("recovers from malformed history and persists only terminal summaries", async () => {
    const root = await mkdtemp(join(tmpdir(), "truss-agent-history-"));
    roots.push(root);
    const store = new FileAgentRunHistoryStore(root);
    await store.save([]);
    await writeFile(agentRunHistoryPath(root), "not json", "utf8");
    expect(await store.load()).toEqual([]);

    const completed = {
      id: "run-1",
      agentId: "agent-1",
      state: "completed" as const,
      prompt: "Review the diff",
      startedAt: "2026-07-27T00:00:00.000Z",
      completedAt: "2026-07-27T00:00:01.000Z",
      changedFiles: ["packages/runtime/src/agents.ts"],
    };
    await store.save([completed]);

    expect(await store.load()).toEqual([completed]);
  });
});
