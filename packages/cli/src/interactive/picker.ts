import type { KeyEvent } from "./input.js";
import type { Style } from "./renderer.js";
import { sanitize, truncate } from "./text.js";

export interface PickerItem {
  readonly label: string;
  readonly value: string;
  readonly detail?: string;
  /** Marks the active choice and starts the highlight there. */
  readonly current?: boolean;
}

export interface PickerState {
  readonly title: string;
  readonly items: readonly PickerItem[];
  /** Index into the visible items. */
  readonly index: number;
  /** Typed text narrows long lists; short lists take a number instead. */
  readonly filterable: boolean;
  readonly filter: string;
}

export interface PickerResult {
  readonly state: PickerState;
  readonly picked?: PickerItem;
  readonly cancelled?: boolean;
}

const pickerRows = 8;

export function openPicker(
  title: string,
  items: readonly PickerItem[],
  filterable = items.length > 9,
): PickerState {
  return {
    title,
    items,
    index: Math.max(
      0,
      items.findIndex((item) => item.current),
    ),
    filterable,
    filter: "",
  };
}

export function visibleItems(state: PickerState): readonly PickerItem[] {
  const needle = state.filter.toLowerCase();
  return needle
    ? state.items.filter((item) =>
        `${item.label} ${item.detail ?? ""}`.toLowerCase().includes(needle),
      )
    : state.items;
}

function refilter(state: PickerState, filter: string): PickerState {
  return { ...state, filter, index: 0 };
}

/** Pure key handling for an open menu. */
export function reducePicker(state: PickerState, key: KeyEvent): PickerResult {
  const visible = visibleItems(state);
  const move = (delta: number): PickerResult => ({
    state: visible.length
      ? {
          ...state,
          index: (state.index + delta + visible.length) % visible.length,
        }
      : state,
  });
  switch (key.type) {
    case "up":
      return move(-1);
    case "down":
    case "tab":
      return move(1);
    case "enter": {
      const picked = visible[state.index];
      return picked ? { state, picked } : { state };
    }
    case "escape":
    case "interrupt":
    case "eof":
      return { state, cancelled: true };
    case "backspace":
      return state.filterable && state.filter
        ? { state: refilter(state, state.filter.slice(0, -1)) }
        : { state };
    case "clear-line":
      return state.filterable ? { state: refilter(state, "") } : { state };
    case "text":
    case "paste": {
      const text = sanitize(key.text).replace(/\n/g, "");
      if (state.filterable)
        return text
          ? { state: refilter(state, state.filter + text) }
          : { state };
      const number = Number.parseInt(text, 10);
      const picked = String(number) === text ? visible[number - 1] : undefined;
      return picked ? { state, picked } : { state };
    }
    default:
      return { state };
  }
}

/** Menu lines for the live region; the cursor sits after the filter. */
export function renderPicker(
  state: PickerState,
  width: number,
  style: Style,
): {
  readonly lines: string[];
  readonly cursorRow: number;
  readonly cursorColumn: number;
} {
  const visible = visibleItems(state);
  const lines = [style.bold(truncate(state.title, width - 1))];
  const filterLine = state.filterable
    ? `  Filter: ${truncate(state.filter, width - 12)}`
    : undefined;
  if (filterLine !== undefined) lines.push(filterLine);
  const start = Math.max(
    0,
    Math.min(state.index - pickerRows + 1, visible.length - pickerRows),
  );
  const labelWidth = Math.min(
    40,
    Math.max(0, ...visible.map((item) => item.label.length)),
  );
  visible.slice(start, start + pickerRows).forEach((item, offset) => {
    const position = start + offset;
    const marker = item.current ? "●" : " ";
    const number = state.filterable
      ? "   "
      : `${String(position + 1).padStart(2)}.`;
    const row = truncate(
      `${marker} ${number} ${item.label.padEnd(labelWidth)}  ${item.detail ?? ""}`.trimEnd(),
      width - 1,
    );
    lines.push(position === state.index ? style.inverse(row) : row);
  });
  if (!visible.length) lines.push(style.dim("  No matches."));
  if (visible.length > pickerRows)
    lines.push(style.dim(`  ${visible.length} items`));
  lines.push(
    style.dim(
      state.filterable
        ? "  ↑↓ move · type to filter · Enter choose · Esc cancel"
        : "  ↑↓ or number · Enter choose · Esc cancel",
    ),
  );
  return {
    lines,
    cursorRow: filterLine === undefined ? 0 : 1,
    cursorColumn:
      filterLine === undefined ? 0 : Math.min(width - 1, filterLine.length),
  };
}
