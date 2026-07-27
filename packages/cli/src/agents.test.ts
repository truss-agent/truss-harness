import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileAgentProfileStore } from "./agents.js";

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
