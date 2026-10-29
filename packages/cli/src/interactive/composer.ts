import {
  filterCommands,
  type InteractiveCommand,
  interactiveCommands,
} from "./commands.js";
import type { KeyEvent } from "./input.js";
import { nextBoundary, previousBoundary, sanitize } from "./text.js";

export interface ComposerState {
  readonly text: string;
  /** UTF-16 index, always on a grapheme boundary. */
  readonly cursor: number;
  readonly history: readonly string[];
  /** Index into history while browsing; undefined for the live draft. */
  readonly historyIndex?: number;
  /** Draft saved when history browsing started. */
  readonly savedDraft?: string;
  readonly menuIndex: number;
  /** Escape hides the menu until the draft changes. */
  readonly menuDismissed: boolean;
}

export type ComposerAction =
  | { readonly type: "submit"; readonly text: string }
  | { readonly type: "interrupt" }
  | { readonly type: "eof" };

export interface ComposerResult {
  readonly state: ComposerState;
  readonly action?: ComposerAction;
}

const historyLimit = 200;

export function emptyComposer(history: readonly string[] = []): ComposerState {
  return { text: "", cursor: 0, history, menuIndex: 0, menuDismissed: false };
}

/** Commands the menu shows for the current draft. */
export function menuCommands(
  state: ComposerState,
  commands: readonly InteractiveCommand[] = interactiveCommands,
): readonly InteractiveCommand[] {
  return state.menuDismissed ? [] : filterCommands(state.text, commands);
}

function edit(
  state: ComposerState,
  text: string,
  cursor: number,
): ComposerState {
  return {
    ...state,
    text,
    cursor,
    historyIndex: undefined,
    savedDraft: undefined,
    menuIndex: 0,
    menuDismissed: false,
  };
}

function insert(state: ComposerState, value: string): ComposerState {
  return edit(
    state,
    state.text.slice(0, state.cursor) + value + state.text.slice(state.cursor),
    state.cursor + value.length,
  );
}

function lineStart(text: string, cursor: number): number {
  return text.lastIndexOf("\n", cursor - 1) + 1;
}

function lineEnd(text: string, cursor: number): number {
  const end = text.indexOf("\n", cursor);
  return end < 0 ? text.length : end;
}

function wordLeft(text: string, cursor: number): number {
  let index = cursor;
  while (index > 0 && /\s/.test(text[index - 1] ?? "")) index--;
  while (index > 0 && !/\s/.test(text[index - 1] ?? "")) index--;
  return index;
}

function wordRight(text: string, cursor: number): number {
  let index = cursor;
  while (index < text.length && /\s/.test(text[index] ?? "")) index++;
  while (index < text.length && !/\s/.test(text[index] ?? "")) index++;
  return index;
}

function browseHistory(state: ComposerState, delta: -1 | 1): ComposerState {
  if (!state.history.length) return state;
  const current = state.historyIndex ?? state.history.length;
  const next = Math.min(Math.max(current + delta, 0), state.history.length);
  if (next === current) return state;
  const text =
    next === state.history.length
      ? (state.savedDraft ?? "")
      : (state.history[next] ?? "");
  return {
    ...state,
    text,
    cursor: text.length,
    historyIndex: next === state.history.length ? undefined : next,
    savedDraft:
      state.historyIndex === undefined ? state.text : state.savedDraft,
    menuIndex: 0,
  };
}

/** Pure key handling. The caller owns rendering and running actions. */
export function reduceComposer(
  state: ComposerState,
  key: KeyEvent,
  commands: readonly InteractiveCommand[] = interactiveCommands,
): ComposerResult {
  const menu = menuCommands(state, commands);
  const { text, cursor } = state;
  switch (key.type) {
    case "text":
      return { state: insert(state, sanitize(key.text).replace(/\n/g, "")) };
    case "paste":
      // Pasted newlines stay text; only a real Enter key submits.
      return { state: insert(state, sanitize(key.text)) };
    case "newline":
      return { state: insert(state, "\n") };
    case "tab":
      if (menu.length) {
        const chosen = menu[state.menuIndex % menu.length];
        const value = chosen ? `/${chosen.name} ` : text;
        return { state: edit(state, value, value.length) };
      }
      return { state: insert(state, "  ") };
    case "enter": {
      // A partial name runs the highlighted command; an exact name runs itself.
      if (
        menu.length &&
        !menu.some((command) => command.name === text.slice(1))
      ) {
        const chosen = menu[state.menuIndex % menu.length];
        if (chosen) return submit(state, `/${chosen.name}`);
      }
      if (!text.trim()) return { state };
      return submit(state, text);
    }
    case "backspace":
      if (cursor === 0) return { state };
      return {
        state: edit(
          state,
          text.slice(0, previousBoundary(text, cursor)) + text.slice(cursor),
          previousBoundary(text, cursor),
        ),
      };
    case "delete":
      if (cursor === text.length) return { state };
      return {
        state: edit(
          state,
          text.slice(0, cursor) + text.slice(nextBoundary(text, cursor)),
          cursor,
        ),
      };
    case "delete-word": {
      const start = wordLeft(text, cursor);
      return {
        state: edit(state, text.slice(0, start) + text.slice(cursor), start),
      };
    }
    case "clear-line": {
      // At the start of a line, join it to the line above instead.
      const start =
        cursor > 0 && lineStart(text, cursor) === cursor
          ? cursor - 1
          : lineStart(text, cursor);
      return {
        state: edit(state, text.slice(0, start) + text.slice(cursor), start),
      };
    }
    case "kill-to-end":
      return {
        state: edit(
          state,
          text.slice(0, cursor) + text.slice(lineEnd(text, cursor)),
          cursor,
        ),
      };
    case "left":
      return { state: { ...state, cursor: previousBoundary(text, cursor) } };
    case "right":
      return { state: { ...state, cursor: nextBoundary(text, cursor) } };
    case "word-left":
      return { state: { ...state, cursor: wordLeft(text, cursor) } };
    case "word-right":
      return { state: { ...state, cursor: wordRight(text, cursor) } };
    case "home":
      return { state: { ...state, cursor: lineStart(text, cursor) } };
    case "end":
      return { state: { ...state, cursor: lineEnd(text, cursor) } };
    case "up":
      if (menu.length)
        return {
          state: {
            ...state,
            menuIndex: (state.menuIndex - 1 + menu.length) % menu.length,
          },
        };
      if (lineStart(text, cursor) > 0) {
        const start = lineStart(text, cursor);
        const previous = lineStart(text, start - 1);
        return {
          state: {
            ...state,
            cursor: Math.min(previous + (cursor - start), start - 1),
          },
        };
      }
      return { state: browseHistory(state, -1) };
    case "down":
      if (menu.length)
        return {
          state: { ...state, menuIndex: (state.menuIndex + 1) % menu.length },
        };
      if (lineEnd(text, cursor) < text.length) {
        const start = lineStart(text, cursor);
        const nextStart = lineEnd(text, cursor) + 1;
        return {
          state: {
            ...state,
            cursor: Math.min(
              nextStart + (cursor - start),
              lineEnd(text, nextStart),
            ),
          },
        };
      }
      return { state: browseHistory(state, 1) };
    case "escape":
      return {
        state: menu.length
          ? { ...state, menuDismissed: true }
          : edit(state, "", 0),
      };
    case "interrupt":
      return { state, action: { type: "interrupt" } };
    case "eof":
      return text ? { state } : { state, action: { type: "eof" } };
  }
}

function submit(state: ComposerState, text: string): ComposerResult {
  const history =
    state.history.at(-1) === text
      ? state.history
      : [...state.history, text].slice(-historyLimit);
  return {
    state: emptyComposer(history),
    action: { type: "submit", text },
  };
}
