import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTerminalTool, grepTool, replaceInFileTool, writeFileTool } from "./tools.js";

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

  it("matches a unique replacement across LF and CRLF line-ending differences", async () => {
    const root = await workspace();
    await writeFile(join(root, "README.md"), "# Project\r\n\r\nOld note\r\n", "utf8");

    await replaceInFileTool.execute({ path: "README.md", oldText: "# Project\n\nOld note", newText: "# Project\n\nNew note" }, { workspaceRoot: root });

    await expect(readFile(join(root, "README.md"), "utf8")).resolves.toBe("# Project\r\n\r\nNew note\r\n");
  });

  it("matches a unique replacement when only indentation differs", async () => {
    const root = await workspace();
    await writeFile(join(root, "example.ts"), "function run() {\n    return true;\n}\n", "utf8");

    await replaceInFileTool.execute({ path: "example.ts", oldText: "function run() {\n  return true;\n}", newText: "function run() {\n  return false;\n}" }, { workspaceRoot: root });

    await expect(readFile(join(root, "example.ts"), "utf8")).resolves.toBe("function run() {\n  return false;\n}\n");
  });

  it("initializes a blank file from a focused replacement", async () => {
    const root = await workspace();
    await writeFile(join(root, "index.html"), "\n\n", "utf8");

    await expect(
      replaceInFileTool.execute(
        { path: "index.html", oldText: "<main>old</main>", newText: "<main>new</main>" },
        { workspaceRoot: root },
      ),
    ).resolves.toEqual({ content: "File was blank; wrote replacement content." });

    await expect(readFile(join(root, "index.html"), "utf8")).resolves.toBe("<main>new</main>");
  });

  it("rejects suspicious truncation of a large existing file", async () => {
    const root = await workspace();
    await writeFile(join(root, "README.md"), "x".repeat(5_000), "utf8");

    await expect(writeFileTool.execute({ path: "README.md", content: "short" }, { workspaceRoot: root })).rejects.toThrow("substantially less content");
  });

  it("allows empty content when clearing a file", async () => {
    const root = await workspace();
    await writeFile(join(root, "README.md"), "existing content", "utf8");

    await expect(
      writeFileTool.execute({ path: "README.md", content: "" }, { workspaceRoot: root }),
    ).resolves.toEqual({ content: "File written." });

    await expect(readFile(join(root, "README.md"), "utf8")).resolves.toBe("");
  });

  it("allows an empty oldText when initializing a blank file", async () => {
    const root = await workspace();
    await writeFile(join(root, "index.html"), "", "utf8");

    await expect(
      replaceInFileTool.execute(
        { path: "index.html", oldText: "", newText: "<main>new</main>" },
        { workspaceRoot: root },
      ),
    ).resolves.toEqual({ content: "File was blank; wrote replacement content." });
  });

  it("keeps workspace paths non-empty", async () => {
    const root = await workspace();

    await expect(
      writeFileTool.execute({ path: "", content: "text" }, { workspaceRoot: root }),
    ).rejects.toThrow("'path' must be a non-empty string");
  });

  it("keeps search queries and terminal commands non-empty", async () => {
    const root = await workspace();

    await expect(grepTool.execute({ query: "" }, { workspaceRoot: root })).rejects.toThrow(
      "'query' must be a non-empty string",
    );
    await expect(createTerminalTool().execute({ command: "" }, { workspaceRoot: root })).rejects.toThrow(
      "'command' must be a non-empty string",
    );
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

describe("tool argument recovery", () => {
  it("accepts numeric-string result limits", async () => {
    const root = await workspace();
    await writeFile(join(root, "README.md"), "first\nneedle\nsecond\nneedle\n", "utf8");

    const result = await grepTool.execute({ query: "needle", maxResults: "1" }, { workspaceRoot: root });

    expect(result.content.split("\n")).toHaveLength(1);
  });
});
