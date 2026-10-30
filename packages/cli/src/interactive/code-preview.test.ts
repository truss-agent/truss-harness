import { describe, expect, it } from "vitest";
import {
  diffRows,
  editedContent,
  editSummary,
  formatCode,
  formatDiff,
  languageForPath,
} from "./code-preview.js";
import { createStyle } from "./renderer.js";

const plain = createStyle(false);
const color = createStyle(true);

describe("diffRows", () => {
  it("numbers a small change inside a file too large to diff whole", () => {
    const before = Array.from({ length: 2000 }, (_, i) => `line ${i + 1}`);
    const after = [...before];
    after[1499] = "changed";
    const changed = diffRows(
      `${before.join("\n")}\n`,
      `${after.join("\n")}\n`,
    ).filter((row) => row.kind !== " ");
    expect(changed).toEqual([
      { kind: "-", text: "line 1500", oldLine: 1500, newLine: 1500 },
      { kind: "+", text: "changed", oldLine: 1501, newLine: 1500 },
    ]);
  });

  it("formats hunks with gaps between distant changes", () => {
    const before = "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n";
    const after = "A\nb\nc\nd\ne\nf\ng\nh\ni\nJ\n";
    expect(formatDiff(diffRows(before, after), "x.txt", 60, plain)).toEqual([
      "     1 - a",
      "     1 + A",
      "     2   b",
      "     3   c",
      "         …",
      "     8   h",
      "     9   i",
      "    10 - j",
      "    10 + J",
    ]);
  });
});

describe("previews", () => {
  it("shows the first lines of new code with a remainder count", () => {
    expect(formatCode("a\nb\nc\n", "x.py", 60, plain, 2)).toEqual([
      "    1 a",
      "    2 b",
      "    … +1 lines",
    ]);
  });

  it("highlights by extension and tints changed lines in color", () => {
    const [row] = formatDiff(diffRows("", "const x = 1;\n"), "a.ts", 40, color);
    expect(row).toContain("\x1b[48;5;22m");
    expect(row).toContain("\x1b[35mconst\x1b[39m");
    expect(languageForPath("src/App.TSX")).toBe("tsx");
    expect(languageForPath("Dockerfile")).toBe("dockerfile");
    expect(languageForPath("README")).toBe("text");
  });

  it("summarizes writes and updates", () => {
    expect(editSummary("a.txt", undefined, "x\ny\n", plain)).toBe(
      "Wrote 2 lines to a.txt",
    );
    expect(editSummary("a.txt", "x\n", "x\ny\n", plain)).toBe(
      "Updated a.txt with 1 addition and 0 removals",
    );
  });
});

describe("editedContent", () => {
  it("replays a unique replacement, across CRLF line endings", () => {
    const input = { oldText: "b\nc", newText: "B" };
    expect(editedContent("replace_in_file", input, "a\r\nb\r\nc\r\n")).toBe(
      "a\nB\n",
    );
    expect(
      editedContent("replace_in_file", input, "b\nc\nb\nc\n"),
    ).toBeUndefined();
    expect(editedContent("replace_in_file", input, "")).toBe("B");
    expect(editedContent("write_file", { content: "z" }, "old")).toBe("z");
  });
});
