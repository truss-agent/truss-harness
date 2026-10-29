import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { resolveWorkspacePath } from "./workspace.js";
import {
  readFileTool,
  writeFileTool,
  grepTool,
  searchFilesTool,
  listDirectoryTool,
  replaceInFileTool,
} from "./tools.js";
import { FileWorkspaceMemoryStore } from "./memory.js";
import { FileWorkspacePlanStore } from "./plans.js";
import { executeWorkspaceCommand } from "./commands.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const base = await mkdtemp(join(tmpdir(), "truss-boundary-"));
  roots.push(base);
  const root = join(base, "root"),
    outside = join(base, "outside");
  await mkdir(root);
  await mkdir(outside);
  await writeFile(join(outside, "canary.txt"), "outside");
  await symlink(outside, join(root, "escape"));
  return { root, outside, base };
}
it("rejects external file and directory symlinks for all builtin file operations", async () => {
  const { root, outside } = await fixture();
  await symlink(join(outside, "canary.txt"), join(root, "file-link"));
  for (const tool of [
    readFileTool,
    writeFileTool,
    replaceInFileTool,
    listDirectoryTool,
    grepTool,
    searchFilesTool,
  ]) {
    await expect(
      tool.execute(
        {
          path:
            tool === readFileTool || tool === replaceInFileTool
              ? "file-link"
              : "escape/new/deep.txt",
          content: "changed",
          oldText: "outside",
          newText: "changed",
          query: "canary",
        },
        { workspaceRoot: root },
      ),
    ).rejects.toThrow(/workspace/i);
  }
  expect(await readFile(join(outside, "canary.txt"), "utf8")).toBe("outside");
});
it("permits internal symlinks, symlinked roots and dot-prefixed normal names", async () => {
  const { root, base } = await fixture();
  await mkdir(join(root, "safe"));
  await symlink(join(root, "safe"), join(root, "alias"));
  await symlink(root, join(base, "root-link"));
  expect(resolveWorkspacePath(root, "..normal")).toBe(join(root, "..normal"));
  await writeFileTool.execute(
    { path: "alias/nested/new.txt", content: "ok" },
    { workspaceRoot: join(base, "root-link") },
  );
  expect(await readFile(join(root, "safe/nested/new.txt"), "utf8")).toBe("ok");
});
it("blocks default memory, plans and init from following external state/instructions links", async () => {
  const { root, outside } = await fixture();
  await symlink(outside, join(root, ".truss-harness"));
  await symlink(join(outside, "canary.txt"), join(root, "AGENTS.md"));
  await expect(
    new FileWorkspaceMemoryStore(root).updateRepositoryState({
      updatedAt: "now",
      changedFiles: [],
    }),
  ).rejects.toThrow(/workspace/i);
  await expect(
    new FileWorkspacePlanStore(root).create({
      title: "x",
      objective: "x",
      steps: ["x"],
    }),
  ).rejects.toThrow(/workspace/i);
  await expect(
    executeWorkspaceCommand({ workspaceRoot: root, input: "/init" }),
  ).rejects.toThrow(/workspace/i);
  expect(await readFile(join(outside, "canary.txt"), "utf8")).toBe("outside");
});
it("preserves explicitly injected alternate memory and plan locations", async () => {
  const { root, outside } = await fixture();
  const memory = new FileWorkspaceMemoryStore(root, {
    path: join(outside, "memory.json"),
  });
  await memory.updateRepositoryState({ updatedAt: "now", changedFiles: [] });
  expect((await memory.load()).repository?.updatedAt).toBe("now");
  const plans = new FileWorkspacePlanStore(root, join(outside, "plan.json"));
  await plans.create({ title: "x", objective: "x", steps: ["x"] });
  expect((await plans.load())?.title).toBe("x");
});
it("rejects dangling outside symlinks before a nested create", async () => {
  const { root, outside } = await fixture();
  await symlink(join(outside, "does-not-exist"), join(root, "dangling"));
  await expect(
    writeFileTool.execute(
      { path: "dangling/nested/new.txt", content: "no" },
      { workspaceRoot: root },
    ),
  ).rejects.toThrow(/workspace/i);
});
