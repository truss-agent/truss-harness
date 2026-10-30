import type { ComposerView } from "./renderer.js";
import { displayWidth, sanitize, wrap } from "./text.js";

/**
 * Transcript-preserving output. Finished transcript lines are written once
 * into normal scrollback; only the live region below them (a streaming
 * partial line plus the composer) is erased and redrawn.
 *
 * Given the terminal height, the composer stays on the bottom rows: blank
 * rows fill the space between the transcript and the composer and are used
 * up as transcript lines are printed.
 */
export class LiveScreen {
  private partial = "";
  private view: ComposerView = { lines: [], cursorRow: 0, cursorColumn: 0 };
  /** Rows above the cursor that belong to the live region. */
  private cursorOffset = 0;
  private drawn = false;
  /** Screen rows from the top of the live region to the bottom. */
  private reserved = 0;
  private anchored = false;

  constructor(
    private readonly write: (text: string) => void,
    private readonly columns: () => number,
    private readonly rows?: () => number,
  ) {}

  /** Appends transcript text, which may end mid-line while streaming. */
  print(text: string): void {
    if (!text) return;
    const combined = this.partial + text;
    const end = combined.lastIndexOf("\n");
    this.anchor();
    this.erase();
    if (end >= 0) {
      const finished = combined.slice(0, end);
      this.write(`${finished.replace(/\n/g, "\r\n")}\r\n`);
      this.reserved = Math.max(0, this.reserved - this.rowsOf(finished));
      this.partial = combined.slice(end + 1);
    } else this.partial = combined;
    this.draw();
  }

  /** Ends a streaming line so the next block starts on its own row. */
  endLine(): void {
    if (this.partial) this.print("\n");
  }

  /** Shows an unfinished streaming line in the live region. */
  setPending(text: string): void {
    if (text === this.partial) return;
    this.erase();
    this.partial = text;
    this.draw();
  }

  render(view: ComposerView): void {
    this.view = view;
    this.erase();
    this.draw();
  }

  /** Removes the live region, leaving the cursor where it began. */
  clear(): void {
    this.erase();
    this.view = { lines: [], cursorRow: 0, cursorColumn: 0 };
  }

  /**
   * Scrolls earlier shell output into scrollback, as Ctrl+L does, and starts
   * at the top of an empty screen so the composer can sit at the bottom.
   */
  private anchor(): void {
    if (this.anchored || !this.rows) return;
    this.anchored = true;
    const height = Math.max(1, this.rows());
    if (height > 1)
      this.write(`${"\r\n".repeat(height - 1)}\x1b[${height - 1}A`);
    this.reserved = height;
  }

  /** Screen rows the finished transcript text takes once wrapped. */
  private rowsOf(text: string): number {
    const width = Math.max(10, this.columns());
    return text
      .split("\n")
      .reduce(
        (total, line) =>
          total + Math.max(1, Math.ceil(displayWidth(sanitize(line)) / width)),
        0,
      );
  }

  private erase(): void {
    if (!this.drawn) return;
    this.write(
      `${this.cursorOffset ? `\x1b[${this.cursorOffset}A` : ""}\r\x1b[J`,
    );
    this.cursorOffset = 0;
    this.drawn = false;
  }

  private draw(): void {
    const width = Math.max(10, this.columns());
    const partialRows = this.partial ? wrap(this.partial, width) : [];
    if (!partialRows.length && !this.view.lines.length) return;
    this.anchor();
    if (this.rows)
      this.reserved = Math.min(this.reserved, Math.max(1, this.rows()));
    const padding = this.view.lines.length
      ? Math.max(0, this.reserved - partialRows.length - this.view.lines.length)
      : 0;
    const lines = [
      ...partialRows,
      ...new Array<string>(padding).fill(""),
      ...this.view.lines,
    ];
    this.reserved = Math.max(this.reserved, lines.length);
    const cursorRow = this.view.lines.length
      ? partialRows.length + padding + this.view.cursorRow
      : lines.length - 1;
    const cursorColumn = this.view.lines.length
      ? this.view.cursorColumn
      : displayWidth(lines.at(-1) ?? "");
    const up = lines.length - 1 - cursorRow;
    this.write(
      `\x1b[?25l${lines.join("\r\n")}${up ? `\x1b[${up}A` : ""}\r${cursorColumn ? `\x1b[${cursorColumn}C` : ""}\x1b[?25h`,
    );
    this.cursorOffset = cursorRow;
    this.drawn = true;
  }
}

export interface TerminalInput {
  readonly isTTY?: boolean;
  setRawMode?(mode: boolean): unknown;
  setEncoding(encoding: BufferEncoding): unknown;
  on(event: "data", listener: (chunk: string) => void): unknown;
  removeListener(event: "data", listener: (chunk: string) => void): unknown;
  resume(): unknown;
  pause(): unknown;
}

export interface TerminalOutput {
  readonly columns?: number;
  readonly rows?: number;
  write(text: string): unknown;
  on(event: "resize", listener: () => void): unknown;
  removeListener(event: "resize", listener: () => void): unknown;
}

export interface OpenTerminal {
  readonly columns: () => number;
  readonly rows: () => number;
  readonly write: (text: string) => void;
  /** Restores cooked mode, disables bracketed paste and shows the cursor. */
  restore(): void;
  /** Hands the terminal to line-based prompts until `resume`. */
  suspend(): void;
  resume(): void;
}

/**
 * Enters raw mode with bracketed paste. Restoration is idempotent and also
 * runs on process exit, so a crash cannot leave the shell in raw mode.
 */
export function openTerminal(
  input: TerminalInput,
  output: TerminalOutput,
  handlers: {
    readonly onData: (chunk: string) => void;
    readonly onResize: () => void;
  },
): OpenTerminal {
  let restored = false;
  let suspended = false;
  const attach = (): void => {
    input.setEncoding("utf8");
    input.setRawMode?.(true);
    input.on("data", handlers.onData);
    input.resume();
    output.write("\x1b[?2004h");
  };
  const detach = (): void => {
    input.removeListener("data", handlers.onData);
    output.write("\x1b[?2004l\x1b[?25h");
    input.setRawMode?.(false);
    input.pause();
  };
  attach();
  output.on("resize", handlers.onResize);
  const restore = (): void => {
    if (restored) return;
    restored = true;
    if (!suspended) detach();
    output.removeListener("resize", handlers.onResize);
    process.removeListener("exit", restore);
  };
  process.once("exit", restore);
  return {
    columns: () => output.columns ?? 80,
    rows: () => output.rows ?? 24,
    write: (text) => {
      output.write(text);
    },
    restore,
    suspend: () => {
      if (restored || suspended) return;
      suspended = true;
      detach();
    },
    resume: () => {
      if (restored || !suspended) return;
      suspended = false;
      attach();
    },
  };
}
