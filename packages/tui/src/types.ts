import type { SyntaxToken } from "./file-browser.js";

export const focusOrder = ["files", "editor", "chat", "terminal"] as const;

export type Focus = (typeof focusOrder)[number];

export type Screen =
  | "workspace"
  | "settings"
  | "approval"
  | "help"
  | "file-search"
  | "agents"
  | "mcp";

export type SettingsField =
  | "server"
  | "endpoint"
  | "model"
  | "internet"
  | "theme";

export type RunStatus = "ready" | "thinking" | "tool" | "waiting";

export interface ChatMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface ChatDisplayLine {
  readonly key: string;
  readonly role: ChatMessage["role"];
  readonly text: string;
  readonly header: boolean;
}

export interface EditorDisplayRow {
  readonly key: string;
  readonly sourceLine: number;
  readonly continuation: boolean;
  readonly tokens: readonly SyntaxToken[];
}

export interface Viewport {
  readonly columns: number;
  readonly rows: number;
}
