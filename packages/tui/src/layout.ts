import { clamp } from "./display.js";
import { type Focus, focusOrder, type Viewport } from "./types.js";

export interface TuiLayout {
  readonly compact: boolean;
  readonly terminalHeight: number;
  readonly workspaceHeight: number;
  readonly filesWidth: number;
  readonly chatWidth: number;
  readonly editorWidth: number;
  readonly compactChatHeight: number;
  readonly editorHeight: number;
  readonly editorLineCount: number;
  readonly overlayWidth: number;
}

export function calculateLayout(viewport: Viewport): TuiLayout {
  const compact = viewport.columns < 106;
  const terminalHeight = clamp(Math.floor(viewport.rows * 0.24), 7, 11);
  const workspaceHeight = Math.max(
    compact ? 14 : 9,
    viewport.rows - terminalHeight - 6,
  );
  const filesWidth = Math.max(
    20,
    Math.min(36, Math.floor(viewport.columns * 0.24)),
  );
  const chatWidth = compact
    ? Math.max(40, viewport.columns - 4)
    : Math.max(28, Math.min(48, Math.floor(viewport.columns * 0.31)));
  const editorWidth = compact
    ? Math.max(30, viewport.columns - filesWidth - 4)
    : Math.max(30, viewport.columns - filesWidth - chatWidth - 4);
  const compactChatHeight = compact
    ? clamp(Math.floor(workspaceHeight * 0.4), 6, 10)
    : workspaceHeight;
  const editorHeight = compact
    ? Math.max(6, workspaceHeight - compactChatHeight - 1)
    : workspaceHeight;
  return {
    compact,
    terminalHeight,
    workspaceHeight,
    filesWidth,
    chatWidth,
    editorWidth,
    compactChatHeight,
    editorHeight,
    editorLineCount: Math.max(2, editorHeight - 3),
    overlayWidth: clamp(viewport.columns - 4, 42, 90),
  };
}

export type FocusAction =
  | { readonly type: "next" }
  | { readonly type: "previous" }
  | { readonly type: "select"; readonly focus: Focus };

export function focusReducer(current: Focus, action: FocusAction): Focus {
  if (action.type === "select") return action.focus;
  const direction = action.type === "next" ? 1 : -1;
  const index = focusOrder.indexOf(current);
  return focusOrder[
    (index + direction + focusOrder.length) % focusOrder.length
  ];
}
