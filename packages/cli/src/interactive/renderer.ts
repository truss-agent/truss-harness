import type { InteractiveCommand } from "./commands.js";
import type { ComposerState } from "./composer.js";
import { displayWidth, sanitize, truncate, wrap } from "./text.js";

export interface Style {
  readonly color: boolean;
  dim(text: string): string;
  bold(text: string): string;
  accent(text: string): string;
  success(text: string): string;
  warning(text: string): string;
  error(text: string): string;
  inverse(text: string): string;
}

const sgr =
  (open: string, close: string) =>
  (text: string): string =>
    `\x1b[${open}m${text}\x1b[${close}m`;

export function createStyle(color: boolean): Style {
  const plain = (text: string) => text;
  return color
    ? {
        color,
        dim: sgr("2", "22"),
        bold: sgr("1", "22"),
        accent: sgr("36", "39"),
        success: sgr("32", "39"),
        warning: sgr("33", "39"),
        error: sgr("31", "39"),
        inverse: sgr("7", "27"),
      }
    : {
        color,
        dim: plain,
        bold: plain,
        accent: plain,
        success: plain,
        warning: plain,
        error: plain,
        inverse: plain,
      };
}

/** Color only for a TTY that allows it (NO_COLOR, TERM=dumb). */
export function colorEnabled(
  environment: NodeJS.ProcessEnv,
  isTTY: boolean,
): boolean {
  if (!isTTY || environment.TERM === "dumb") return false;
  if (environment.NO_COLOR !== undefined && environment.NO_COLOR !== "")
    return false;
  return true;
}

export interface ComposerView {
  readonly lines: readonly string[];
  /** Cursor position relative to the first line of `lines`. */
  readonly cursorRow: number;
  readonly cursorColumn: number;
}

const promptMark = "› ";
const continuation = "  ";
const menuLimit = 8;

/**
 * Draws the live input area: status line, prompt and slash menu. Only this
 * region is redrawn; the transcript above it stays in scrollback.
 */
export function renderComposer(options: {
  readonly state: ComposerState;
  readonly width: number;
  readonly status: string;
  readonly menu: readonly InteractiveCommand[];
  readonly style: Style;
  readonly placeholder?: string;
}): ComposerView {
  const { state, style } = options;
  const width = Math.max(10, options.width);
  const inner = width - promptMark.length;
  const lines: string[] = [style.dim(truncate(options.status, width - 1))];
  let cursorRow = 1;
  let cursorColumn = promptMark.length;
  if (!state.text && options.placeholder) {
    lines.push(
      style.accent(promptMark) +
        style.dim(truncate(options.placeholder, inner - 1)),
    );
  } else {
    const before = wrap(state.text.slice(0, state.cursor), inner);
    const rows = wrap(state.text, inner);
    rows.forEach((row, index) => {
      lines.push((index === 0 ? style.accent(promptMark) : continuation) + row);
    });
    cursorRow = before.length;
    cursorColumn = promptMark.length + displayWidth(before.at(-1) ?? "");
    if (cursorColumn >= width) {
      cursorRow += 1;
      cursorColumn = promptMark.length;
      if (lines.length <= cursorRow) lines.push(continuation);
    }
  }
  if (options.menu.length) {
    const selected = state.menuIndex % options.menu.length;
    const start = Math.max(
      0,
      Math.min(selected - menuLimit + 1, options.menu.length - menuLimit),
    );
    const nameWidth = Math.max(
      ...options.menu.map((command) => command.name.length + 1),
    );
    options.menu.slice(start, start + menuLimit).forEach((command, offset) => {
      const label = `/${command.name}`.padEnd(nameWidth + 2);
      const row = truncate(`  ${label}${command.summary}`, width - 1);
      lines.push(
        start + offset === selected ? style.inverse(row) : style.dim(row),
      );
    });
  }
  return { lines, cursorRow, cursorColumn };
}

/** A submitted user message, echoed into the transcript. */
export function formatUserMessage(
  text: string,
  width: number,
  style: Style,
): string {
  return wrap(sanitize(text), Math.max(10, width - 2))
    .map((row, index) => `${index === 0 ? style.bold("› ") : "  "}${row}`)
    .join("\n");
}

export const toolLabels: Readonly<Record<string, string>> = {
  read_file: "Read",
  write_file: "Write",
  replace_in_file: "Edit",
  apply_patch: "Patch",
  list_directory: "List",
  search_files: "Search",
  grep: "Grep",
  run_terminal: "Run",
  git_status: "Git status",
  git_diff: "Git diff",
  git_commit: "Git commit",
  web_search: "Web search",
  web_fetch: "Fetch",
  load_skill: "Use skill",
  read_skill_resource: "Read skill file",
  request_user_input: "Question",
};

function toolSubject(input: Record<string, unknown> | undefined): string {
  if (!input) return "";
  for (const key of [
    "command",
    "path",
    "pattern",
    "query",
    "url",
    "id",
    "message",
  ]) {
    const value = input[key];
    if (typeof value === "string" && value) return value;
  }
  return "";
}

/** One-line summary of a requested tool call. */
export function formatToolCall(
  tool: string,
  input: Record<string, unknown> | undefined,
  width: number,
  style: Style,
): string {
  return `${style.accent("•")} ${formatToolSummary(tool, input, width - 2, style)}`;
}

/** Tool label and subject without the leading bullet. */
export function formatToolSummary(
  tool: string,
  input: Record<string, unknown> | undefined,
  width: number,
  style: Style,
): string {
  const label = toolLabels[tool] ?? tool;
  const subject = truncate(
    sanitize(toolSubject(input)).replace(/\n/g, " "),
    Math.max(8, width - displayWidth(label) - 2),
  );
  return `${style.bold(label)}${subject ? ` ${subject}` : ""}`;
}

/** Short outcome line under a tool call. */
export function formatToolResult(
  result: { readonly content?: string; readonly isError?: boolean },
  width: number,
  style: Style,
): string {
  const first =
    sanitize(result.content ?? "")
      .split("\n")
      .find((line) => line.trim()) ?? "";
  const lines = sanitize(result.content ?? "").split("\n").length;
  const detail = result.isError
    ? first || "failed"
    : lines > 1
      ? `${lines} lines`
      : first || "done";
  const marker = result.isError ? style.error("✗") : style.success("✓");
  return `  ${marker} ${style.dim(truncate(detail, width - 6))}`;
}

/**
 * Formats completed assistant lines with light Markdown: fenced code is
 * indented and dimmed, headings bold. Keeps fence state across lines.
 */
export class AssistantFormatter {
  private inCode = false;

  constructor(private readonly style: Style) {}

  line(raw: string): string {
    const text = sanitize(raw);
    if (/^\s*```/.test(text)) {
      this.inCode = !this.inCode;
      return this.style.dim(`  ${text.trim()}`);
    }
    if (this.inCode) return `  ${this.style.accent("│")} ${text}`;
    const heading = text.match(/^#{1,6}\s+(.*)$/);
    if (heading) return this.style.bold(heading[1] ?? "");
    return text
      .replace(/\*\*([^*]+)\*\*/g, (_, value: string) => this.style.bold(value))
      .replace(/`([^`]+)`/g, (_, value: string) => this.style.accent(value));
  }

  reset(): void {
    this.inCode = false;
  }
}

/** Help text listing commands and keys. */
export function formatHelp(
  commands: readonly InteractiveCommand[],
  style: Style,
): string {
  const width = Math.max(...commands.map((command) => command.usage.length));
  return [
    style.bold("Commands"),
    ...commands.map(
      (command) => `  ${command.usage.padEnd(width + 2)}${command.summary}`,
    ),
    "",
    style.bold("Keys"),
    "  Enter send · Alt+Enter new line · / commands · Tab complete",
    "  Up/Down history · Esc close menu or clear · Ctrl+C stop, twice to exit",
    "  Ctrl+V attach a clipboard image · paste an image path to attach the file",
    "  Start a message with // to send text that begins with a slash.",
    "  Start a message with ! to run a shell command; its output goes with",
    "  your next message.",
  ].join("\n");
}
