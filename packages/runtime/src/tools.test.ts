import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTerminalTool, replaceInFileTool, writeFileTool } from "./tools.js";

const workspaces: string[] = [];

async function workspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "truss-tools-"));
  workspaces.push(directory);
  return directory;
}

afterEach(async () => { await Promise.all(workspaces.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe("filesystem edit tools", () => {
  it("replaces one exact section without rewriting an existing file", async () => {
    const root = await workspace();
    await writeFile(join(root, "README.md"), "# Project\n\nOld note\n", "utf8");

    await replaceInFileTool.execute({ path: "README.md", oldText: "Old note", newText: "CLI local test" }, { workspaceRoot: root });

    await expect(readFile(join(root, "README.md"), "utf8")).resolves.toBe("# Project\n\nCLI local test\n");
  });

  it("rejects suspicious truncation of a large existing file", async () => {
    const root = await workspace();
    await writeFile(join(root, "README.md"), "x".repeat(5_000), "utf8");

    await expect(writeFileTool.execute({ path: "README.md", content: "short" }, { workspaceRoot: root })).rejects.toThrow("substantially less content");
  });
});

describe("agent terminal tool", () => {
  it("rejects shell commands that write workspace files", async () => {
    const root = await workspace();
    const result = await createTerminalTool().execute({ command: "echo hello >> README.md" }, { workspaceRoot: root });

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain("write_file or replace_in_file");
  });
});
