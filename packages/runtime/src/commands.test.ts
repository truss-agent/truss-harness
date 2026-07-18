import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executeWorkspaceCommand } from "./commands.js";
import { FileWorkspaceMemoryStore } from "./memory.js";

const workspaces: string[] = [];

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "truss-harness-command-"));
  workspaces.push(root);
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "sample", scripts: { test: "vitest run" } }), "utf8");
  await writeFile(join(root, "example.ts"), "export const value = 1;\n", "utf8");
  return root;
}

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("workspace commands", () => {
  it("initializes and refreshes a managed AGENTS.md block without replacing user instructions", async () => {
    const root = await workspace();
    await writeFile(join(root, "AGENTS.md"), "# Team Rules\n\nKeep this line.\n", "utf8");

    const result = await executeWorkspaceCommand({ workspaceRoot: root, input: "/init" });
    const agents = await readFile(join(root, "AGENTS.md"), "utf8");

    expect(result.ok).toBe(true);
    expect(agents).toContain("Keep this line.");
    expect(agents).toContain("truss-harness:workspace-context:start");
    expect(agents).toContain("TypeScript");
    expect(agents).toContain("sample");
  });

  it("records repository state through update and exposes it through status", async () => {
    const root = await workspace();
    const memory = new FileWorkspaceMemoryStore(root);

    const update = await executeWorkspaceCommand({ workspaceRoot: root, input: "/update Finished the initial wiring", memory });
    const status = await executeWorkspaceCommand({ workspaceRoot: root, input: "/status", memory });
    const snapshot = await memory.load();

    expect(update.ok).toBe(true);
    expect(status.message).toContain("Recent memory:");
    expect(snapshot.repository).toBeDefined();
    expect(snapshot.tasks[0]?.objective).toContain("Finished the initial wiring");
  });

  it("recognizes help and rejects unknown slash commands without treating normal prompts as commands", async () => {
    const root = await workspace();

    await expect(executeWorkspaceCommand({ workspaceRoot: root, input: "/help" })).resolves.toMatchObject({ handled: true, ok: true });
    await expect(executeWorkspaceCommand({ workspaceRoot: root, input: "/not-real" })).resolves.toMatchObject({ handled: true, ok: false });
    await expect(executeWorkspaceCommand({ workspaceRoot: root, input: "Explain this repo" })).resolves.toMatchObject({ handled: false, ok: true });
  });
});
