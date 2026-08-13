import { describe, expect, it } from "vitest";
import { calculateLayout, focusReducer } from "./layout.js";

describe("TUI layout and focus", () => {
  it("uses a stacked chat layout in narrow terminals", () => {
    const layout = calculateLayout({ columns: 90, rows: 36 });
    expect(layout.compact).toBe(true);
    expect(layout.chatWidth).toBe(86);
    expect(layout.editorHeight + layout.compactChatHeight + 1).toBe(
      layout.workspaceHeight,
    );
  });

  it("uses three workspace panes in wide terminals", () => {
    const layout = calculateLayout({ columns: 160, rows: 50 });
    expect(layout.compact).toBe(false);
    expect(layout.editorWidth + layout.filesWidth + layout.chatWidth).toBe(156);
  });

  it("cycles focus in both directions", () => {
    expect(focusReducer("terminal", { type: "next" })).toBe("files");
    expect(focusReducer("files", { type: "previous" })).toBe("terminal");
    expect(focusReducer("files", { type: "select", focus: "editor" })).toBe(
      "editor",
    );
  });
});
