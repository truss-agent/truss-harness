import { describe, expect, it } from "vitest";
import { filterCommands, parseInput } from "./commands.js";
import {
  type ComposerState,
  emptyComposer,
  menuCommands,
  reduceComposer,
} from "./composer.js";
import { InputDecoder, type KeyEvent } from "./input.js";
import {
  colorEnabled,
  createStyle,
  formatToolCall,
  formatToolResult,
  renderComposer,
} from "./renderer.js";
import { LiveScreen } from "./terminal.js";
import { displayWidth, sanitize, wrap } from "./text.js";

const plain = createStyle(false);

function type(
  keys: readonly KeyEvent[],
  state: ComposerState = emptyComposer(),
) {
  const actions: unknown[] = [];
  for (const key of keys) {
    const result = reduceComposer(state, key);
    state = result.state;
    if (result.action) actions.push(result.action);
  }
  return { state, actions };
}
const text = (value: string): KeyEvent => ({ type: "text", text: value });
const key = (name: Exclude<KeyEvent["type"], "text" | "paste">): KeyEvent =>
  ({ type: name }) as KeyEvent;

describe("terminal text", () => {
  it("strips escape sequences and controls but keeps text", () => {
    expect(
      sanitize("a\x1b[31mred\x1b[0m\x1b]0;title\x07b\x07c\r\nd\te\x9b"),
    ).toBe("aredbc\nd  e");
  });

  it("measures wide and combining graphemes", () => {
    expect(displayWidth("abc")).toBe(3);
    expect(displayWidth("日本")).toBe(4);
    expect(displayWidth("é")).toBe(1);
    expect(displayWidth("👍🏽")).toBe(2);
    expect(wrap("日本語", 4)).toEqual(["日本", "語"]);
  });
});

describe("commands", () => {
  it("parses commands, colon aliases, unknowns and escaped slashes", () => {
    expect(parseInput("/mode plan")).toMatchObject({
      kind: "command",
      command: { name: "mode" },
      args: "plan",
    });
    expect(parseInput(":mode edit")).toMatchObject({
      command: { name: "mode" },
      args: "edit",
    });
    expect(parseInput(":exit")).toMatchObject({ command: { name: "quit" } });
    expect(parseInput(":clear")).toMatchObject({ command: { name: "new" } });
    expect(parseInput("/frobnicate")).toEqual({
      kind: "unknown",
      name: "frobnicate",
    });
    expect(parseInput("//etc/hosts please")).toEqual({
      kind: "prompt",
      text: "/etc/hosts please",
    });
    expect(parseInput("fix the bug")).toEqual({
      kind: "prompt",
      text: "fix the bug",
    });
  });

  it("filters by prefix and closes once arguments start", () => {
    expect(filterCommands("/s").map((command) => command.name)).toEqual([
      "setup",
      "status",
      "skills",
      "skill",
    ]);
    expect(filterCommands("/").length).toBeGreaterThan(10);
    expect(filterCommands("/mode plan")).toEqual([]);
    expect(filterCommands("hello")).toEqual([]);
  });
});

describe("input decoder", () => {
  it("decodes keys, split sequences and bracketed paste", () => {
    const decoder = new InputDecoder();
    expect(decoder.push("hi\x1b[")).toEqual([text("hi")]);
    expect(decoder.push("D\r\x1b\r\x7f\x03")).toEqual([
      key("left"),
      key("enter"),
      key("newline"),
      key("backspace"),
      key("interrupt"),
    ]);
    expect(decoder.push("\x1b[200~line1\rline2\x1b[20")).toEqual([]);
    expect(decoder.push("1~x")).toEqual([
      { type: "paste", text: "line1\rline2" },
      text("x"),
    ]);
  });

  it("emits a lone Escape only on flush", () => {
    const decoder = new InputDecoder();
    expect(decoder.push("\x1b")).toEqual([]);
    expect(decoder.pending).toBe(true);
    expect(decoder.flush()).toEqual([key("escape")]);
    expect(decoder.push("\x1b[99Zok")).toEqual([text("ok")]);
  });
});

describe("composer", () => {
  it("edits by grapheme and moves through multiline text", () => {
    const { state } = type([
      text("a👍🏽b"),
      key("left"),
      key("backspace"),
      key("newline"),
      text("c"),
    ]);
    expect(state.text).toBe("a\ncb");
    expect(state.cursor).toBe(3);
    const up = type([key("up")], state).state;
    expect(up.cursor).toBe(1);
  });

  it("keeps pasted newlines as text and submits only on Enter", () => {
    const { state, actions } = type([
      { type: "paste", text: "one\r\ntwo\n/quit" },
    ]);
    expect(state.text).toBe("one\ntwo\n/quit");
    expect(actions).toEqual([]);
    expect(type([key("enter")], state).actions).toEqual([
      { type: "submit", text: "one\ntwo\n/quit" },
    ]);
  });

  it("clears a line with Ctrl+U and joins lines at column 0", () => {
    const pasted = type([{ type: "paste", text: "one\ntwo" }]).state;
    const cleared = type([key("clear-line")], pasted).state;
    expect(cleared.text).toBe("one\n");
    expect(type([key("clear-line")], cleared).state.text).toBe("one");
  });

  it("navigates, completes and dismisses the slash menu", () => {
    let result = type([text("/s")]);
    expect(menuCommands(result.state).map((command) => command.name)).toEqual([
      "setup",
      "status",
      "skills",
      "skill",
    ]);
    result = type([key("down"), key("down"), key("tab")], result.state);
    expect(result.state.text).toBe("/skills ");
    expect(menuCommands(result.state)).toEqual([]);

    result = type([text("/mo"), key("enter")]);
    expect(result.actions).toEqual([{ type: "submit", text: "/model" }]);
    // An exact name wins over a longer highlighted match.
    result = type([text("/mode"), key("enter")]);
    expect(result.actions).toEqual([{ type: "submit", text: "/mode" }]);

    result = type([text("/he"), key("escape")]);
    expect(menuCommands(result.state)).toEqual([]);
    expect(result.state.text).toBe("/he");
    result = type([key("escape")], result.state);
    expect(result.state.text).toBe("");
  });

  it("browses history and restores the draft", () => {
    let { state } = type([text("first"), key("enter"), text("second")]);
    state = type([key("enter"), text("draft")], state).state;
    expect(state.history).toEqual(["first", "second"]);
    state = type([key("up"), key("up")], state).state;
    expect(state.text).toBe("first");
    state = type([key("down"), key("down")], state).state;
    expect(state.text).toBe("draft");
  });

  it("reports interrupt and end of input", () => {
    expect(type([key("interrupt")]).actions).toEqual([{ type: "interrupt" }]);
    expect(type([key("eof")]).actions).toEqual([{ type: "eof" }]);
    expect(type([text("x"), key("eof")]).actions).toEqual([]);
  });
});

describe("renderer", () => {
  it("draws status, prompt and menu with the cursor position", () => {
    const state = type([text("/mo")]).state;
    const view = renderComposer({
      state,
      width: 40,
      status: "chat · model",
      menu: menuCommands(state),
      style: plain,
    });
    expect(view.lines).toEqual([
      "chat · model",
      "› /mo",
      "  /model  Choose a model, or switch to…",
      "  /mode   Switch agent mode and keep t…",
    ]);
    expect([view.cursorRow, view.cursorColumn]).toEqual([1, 5]);
  });

  it("summarizes tool calls and results without terminal controls", () => {
    expect(
      formatToolCall("run_terminal", { command: "npm test\x1b[2J" }, 60, plain),
    ).toBe("● Run(npm test)");
    expect(formatToolResult({ content: "a\nb\nc" }, 60, plain)).toBe(
      "  ⎿ 3 lines",
    );
    expect(
      formatToolResult(
        { content: "ENOENT: missing", isError: true },
        60,
        plain,
      ),
    ).toBe("  ⎿ ✗ ENOENT: missing");
  });

  it("honors NO_COLOR, TERM=dumb and non-TTY output", () => {
    expect(colorEnabled({}, true)).toBe(true);
    expect(colorEnabled({ NO_COLOR: "1" }, true)).toBe(false);
    expect(colorEnabled({ TERM: "dumb" }, true)).toBe(false);
    expect(colorEnabled({}, false)).toBe(false);
  });
});

describe("live screen", () => {
  it("keeps finished lines in scrollback and redraws only the live region", () => {
    const writes: string[] = [];
    const screen = new LiveScreen(
      (value) => writes.push(value),
      () => 40,
    );
    screen.render({ lines: ["status", "› hi"], cursorRow: 1, cursorColumn: 4 });
    expect(writes.join("")).toBe("\x1b[?25lstatus\r\n› hi\r\x1b[4C\x1b[?25h");
    writes.length = 0;
    screen.print("Hello wor");
    // Erase the composer from its first row, then redraw partial + composer.
    expect(writes[0]).toBe("\x1b[1A\r\x1b[J");
    expect(writes[1]).toContain("Hello wor\r\nstatus\r\n› hi");
    writes.length = 0;
    screen.print("ld\nNext");
    expect(writes[0]).toBe("\x1b[2A\r\x1b[J");
    expect(writes[1]).toBe("Hello world\r\n");
    expect(writes[2]).toContain("Next\r\nstatus");
  });

  it("keeps the composer on the bottom rows as the transcript grows", () => {
    // A tiny screen model: rows of text, a cursor, and scrolling at the bottom.
    const height = 10;
    let screen: string[] = Array.from({ length: height }, (_, i) =>
      i < 6 ? `shell ${i}` : "",
    );
    let row = 6;
    let column = 0;
    const text = (chunk: string) => {
      for (const part of chunk.split(/(\r|\n)/)) {
        if (part === "\r") column = 0;
        else if (part === "\n") {
          if (row === height - 1) screen = [...screen.slice(1), ""];
          else row++;
        } else if (part) {
          const line = screen[row] ?? "";
          screen[row] = line.slice(0, column).padEnd(column) + part;
          column += part.length;
        }
      }
    };
    const write = (value: string) => {
      const [first = "", ...sequences] = value.split("\x1b[");
      text(first);
      for (const sequence of sequences) {
        const [code = "", , count, command] =
          /^(\??)(\d*)([A-Za-z])/.exec(sequence) ?? [];
        if (command === "A") row = Math.max(0, row - Number(count || 1));
        else if (command === "C") column += Number(count || 1);
        else if (command === "J")
          screen = screen.map((line, i) =>
            i < row ? line : i === row ? line.slice(0, column) : "",
          );
        text(sequence.slice(code.length));
      }
    };
    const live = new LiveScreen(
      write,
      () => 40,
      () => height,
    );
    const composer = {
      lines: ["status", "› hi"],
      cursorRow: 1,
      cursorColumn: 4,
    };
    live.print("banner\n");
    live.render(composer);
    expect(screen.slice(-2)).toEqual(["status", "› hi"]);
    expect(screen[0]).toBe("banner");
    expect(screen.some((line) => line.startsWith("shell"))).toBe(false);
    expect(row).toBe(height - 1);
    live.render({
      lines: ["menu", "status", "› hi"],
      cursorRow: 2,
      cursorColumn: 4,
    });
    live.render(composer);
    expect(screen.slice(-2)).toEqual(["status", "› hi"]);
    expect(screen[0]).toBe("banner");
    for (let i = 1; i <= 12; i++) live.print(`line ${i}\n`);
    expect(screen.slice(-3)).toEqual(["line 12", "status", "› hi"]);
    live.print("streaming");
    expect(screen.slice(-3)).toEqual(["streaming", "status", "› hi"]);
  });
});
