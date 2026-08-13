import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectWorkspaceFiles } from "./workspace-files.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("TUI workspace file collection", () => {
  it("returns sorted workspace files without generated directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "truss-tui-files-"));
    temporaryDirectories.push(root);
    await mkdir(join(root, "src"));
    await mkdir(join(root, "node_modules"));
    await writeFile(join(root, "z.txt"), "z");
    await writeFile(join(root, "src", "a.ts"), "a");
    await writeFile(join(root, "node_modules", "ignored.js"), "ignored");

    await expect(collectWorkspaceFiles(root)).resolves.toEqual([
      { path: "src/a.ts" },
      { path: "z.txt" },
    ]);
  });
});
