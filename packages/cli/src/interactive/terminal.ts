import type { ComposerView } from "./renderer.js";
import { displayWidth, wrap } from "./text.js";

/**
 * Transcript-preserving output. Finished transcript lines are written once
 * into normal scrollback; only the live region below them (a streaming
 * partial line plus the composer) is erased and redrawn.
 */
export class LiveScreen {
  private partial = "";
  private view: ComposerView = { lines: [], cursorRow: 0, cursorColumn: 0 };
  /** Rows above the cursor that belong to the live region. */
  private cursorOffset = 0;
  private drawn = false;

  constructor(
    private readonly write: (text: string) => void,
    private readonly columns: () => number,
  ) {}

  /** Appends transcript text, which may end mid-line while streaming. */
  print(text: string): void {
    if (!text) return;
    const combined = this.partial + text;
    const end = combined.lastIndexOf("\n");
    this.erase();
    if (end >= 0) {
      this.write(`${combined.slice(0, end).replace(/\n/g, "\r\n")}\r\n`);
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
    const lines = [...partialRows, ...this.view.lines];
    if (!lines.length) return;
    const cursorRow = this.view.lines.length
      ? partialRows.length + this.view.cursorRow
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
  write(text: string): unknown;
  on(event: "resize", listener: () => void): unknown;
  removeListener(event: "resize", listener: () => void): unknown;
}

export interface OpenTerminal {
  readonly columns: () => number;
  readonly write: (text: string) => void;
  /** Restores cooked mode, disables bracketed paste and shows the cursor. */
  restore(): void;
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
  input.setEncoding("utf8");
  input.setRawMode?.(true);
  input.on("data", handlers.onData);
  output.on("resize", handlers.onResize);
  input.resume();
  output.write("\x1b[?2004h");
  const restore = (): void => {
    if (restored) return;
    restored = true;
    input.removeListener("data", handlers.onData);
    output.removeListener("resize", handlers.onResize);
    output.write("\x1b[?2004l\x1b[?25h");
    input.setRawMode?.(false);
    input.pause();
    process.removeListener("exit", restore);
  };
  process.once("exit", restore);
  return {
    columns: () => output.columns ?? 80,
    write: (text) => {
      output.write(text);
    },
    restore,
  };
}
