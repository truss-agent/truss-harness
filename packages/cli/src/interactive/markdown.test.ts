import { describe, expect, it } from "vitest";
import { type FenceRenderer, MarkdownRenderer } from "./markdown.js";
import { createStyle } from "./renderer.js";
import { displayWidth, wrapStyled } from "./text.js";

const plain = createStyle(false);
const color = createStyle(true);

function render(
  markdown: string,
  width = 40,
  fences: readonly FenceRenderer[] = [],
  style = plain,
): string[] {
  const renderer = new MarkdownRenderer({ style, width: () => width, fences });
  return [
    ...markdown.split("\n").flatMap((line) => renderer.push(line)),
    ...renderer.end(),
  ];
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: strips SGR for width checks
const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");

describe("markdown", () => {
  it("styles headings, inline marks and links", () => {
    expect(render("# Title\n## Sub")).toEqual(["Title", "Sub"]);
    expect(
      render(
        "**bold** *it* _also_ ~~gone~~ `x*y*` [docs](https://a.b) snake_case_name",
        80,
      ),
    ).toEqual(["bold it also gone x*y* docs (https://a.b) snake_case_name"]);
    const styled = render("**b** *i* ~~s~~ [l](u)", 80, [], color)[0] ?? "";
    expect(styled).toContain("\x1b[1mb\x1b[22m");
    expect(styled).toContain("\x1b[3mi\x1b[23m");
    expect(styled).toContain("\x1b[9ms\x1b[29m");
    expect(styled).toContain("\x1b[4ml\x1b[24m");
  });

  it("wraps paragraphs at words and hangs list and quote indents", () => {
    expect(render("one two three four five six", 14)).toEqual([
      "one two three",
      "four five six",
    ]);
    expect(
      render(
        "- first item wraps here\n  - nested\n1. numbered\n- [x] done\n- [ ] todo",
        16,
      ),
    ).toEqual([
      "• first item",
      "  wraps here",
      "  ◦ nested",
      "1. numbered",
      "☑ done",
      "☐ todo",
    ]);
    expect(render("> quoted words here", 12)).toEqual([
      "│ quoted",
      "│ words here",
    ]);
    expect(render("---", 10)).toEqual(["──────────"]);
  });

  it("draws aligned tables that fit the width", () => {
    expect(
      render(
        "| Name | Qty |\n|:-----|----:|\n| apple | 3 |\n| kiwi | 12 |\nafter",
      ),
    ).toEqual([
      "┌───────┬─────┐",
      "│ Name  │ Qty │",
      "├───────┼─────┤",
      "│ apple │   3 │",
      "│ kiwi  │  12 │",
      "└───────┴─────┘",
      "after",
    ]);
    const narrow = render(
      "| a | b |\n|---|---|\n| a very long cell value | another long one |",
      24,
    );
    for (const row of narrow) expect(displayWidth(row)).toBeLessThanOrEqual(24);
    expect(narrow.join("\n")).toContain("…");
  });

  it("flushes a table still open when the stream ends", () => {
    expect(render("| a |\n|---|\n| 1 |")).toEqual([
      "┌───┐",
      "│ a │",
      "├───┤",
      "│ 1 │",
      "└───┘",
    ]);
  });

  it("labels and colors code fences without touching their text", () => {
    expect(render("```ts\nconst x = 'a'; // hi\n```")).toEqual([
      "  ┌ ts",
      "  │ const x = 'a'; // hi",
      "  └",
    ]);
    const [, code] = render("```ts\nconst x = 'a'; // hi\n```", 40, [], color);
    expect(code).toContain("\x1b[35mconst\x1b[39m");
    expect(code).toContain("\x1b[32m'a'\x1b[39m");
    expect(strip(code ?? "")).toBe("  │ const x = 'a'; // hi");
    const [, added, removed] = render(
      "```diff\n+new\n-old\n```",
      40,
      [],
      color,
    );
    expect(added).toContain("\x1b[32m+new");
    expect(removed).toContain("\x1b[31m-old");
    expect(render("```\n**not bold**\n```")[1]).toBe("  │ **not bold**");
  });

  it("hands whole fences to a registered renderer", () => {
    const upper: FenceRenderer = {
      languages: ["shout"],
      render: (source, width) => [`${source.toUpperCase()} @${width}`],
    };
    expect(render("```shout\nhi\nthere\n```\nafter", 30, [upper])).toEqual([
      "HI",
      "THERE @30",
      "after",
    ]);
  });

  it("strips escape sequences from model text", () => {
    expect(render("evil \x1b[2J**x**")).toEqual(["evil x"]);
  });
});

describe("wrapStyled", () => {
  it("measures without escape codes and keeps them intact", () => {
    const rows = wrapStyled(`${color.bold("alpha")} beta gamma`, 11);
    expect(rows.map(strip)).toEqual(["alpha beta", "gamma"]);
    expect(rows[0]).toContain("\x1b[1malpha\x1b[22m");
  });

  it("breaks words longer than a row", () => {
    expect(wrapStyled("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
  });
});
