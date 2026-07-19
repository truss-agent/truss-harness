import { describe, expect, it } from "vitest";
import { buildFileTree, clipSyntaxTokens, fuzzyFiles, syntaxTokens, wrapSyntaxTokens } from "./file-browser.js";

describe("TUI file browser", () => {
  const files = [{ path: "src/components/Button.tsx" }, { path: "src/index.ts" }, { path: "README.md" }];

  it("builds a directory-first collapsible tree", () => {
    expect(buildFileTree(files, new Set()).map((entry) => `${entry.kind}:${entry.path}`)).toEqual([
      "directory:src",
      "directory:src/components",
      "file:src/components/Button.tsx",
      "file:src/index.ts",
      "file:README.md"
    ]);
    expect(buildFileTree(files, new Set(["src"])).map((entry) => entry.path)).toEqual(["src", "README.md"]);
  });

  it("ranks fuzzy filename matches ahead of path-only matches", () => {
    expect(fuzzyFiles(files, "but")[0]?.path).toBe("src/components/Button.tsx");
    expect(fuzzyFiles(files, "sit")[0]?.path).toBe("src/index.ts");
  });

  it("tokenizes and clips source lines without losing token colors", () => {
    const tokens = syntaxTokens('const value = "hello";', "src/index.ts");
    expect(tokens.some((token) => token.text === "const" && token.color === "magenta")).toBe(true);
    expect(tokens.some((token) => token.text === '"hello"' && token.color === "green")).toBe(true);
    expect(clipSyntaxTokens(tokens, 8).map((token) => token.text).join("")).toBe("const va");
    const rows = wrapSyntaxTokens(tokens, 8);
    expect(rows.map((row) => row.map((token) => token.text).join(""))).toEqual(["const va", "lue = \"h", "ello\";"]);
    expect(rows[2].some((token) => token.color === "green")).toBe(true);
  });
});
