import { describe, expect, it } from "vitest";
import {
  highlightedLanguage,
  isExternalMarkdownLink,
  parseMarkdownBlocks,
} from "./markdown.js";

describe("renderer Markdown", () => {
  it("parses the supported block structure without DOM state", () => {
    expect(
      parseMarkdownBlocks(
        "# Heading\n\nParagraph\ncontinued\n\n- one\n- two\n\n> quote\n\n```ts\nconst value = 1;\n```",
      ),
    ).toEqual([
      { kind: "heading", level: 1, content: "Heading" },
      { kind: "paragraph", content: "Paragraph\ncontinued" },
      { kind: "list", items: ["one", "two"] },
      { kind: "quote", content: "quote" },
      { kind: "code", language: "ts", content: "const value = 1;" },
    ]);
  });

  it("only activates supported external link schemes", () => {
    expect(isExternalMarkdownLink("https://example.com")).toBe(true);
    expect(isExternalMarkdownLink("mailto:test@example.com")).toBe(true);
    expect(isExternalMarkdownLink("javascript:alert(1)")).toBe(false);
    expect(isExternalMarkdownLink("src/index.ts")).toBe(false);
  });

  it("normalizes syntax-highlighting aliases", () => {
    expect(highlightedLanguage("tsx")).toBe("typescript");
    expect(highlightedLanguage("shell")).toBe("bash");
    expect(highlightedLanguage("text")).toBeUndefined();
  });
});
