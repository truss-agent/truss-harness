/** Typed key events decoded from raw terminal input. */
export type KeyEvent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "paste"; readonly text: string }
  | {
      readonly type:
        | "enter"
        | "newline"
        | "backspace"
        | "delete"
        | "left"
        | "right"
        | "up"
        | "down"
        | "home"
        | "end"
        | "word-left"
        | "word-right"
        | "delete-word"
        | "clear-line"
        | "kill-to-end"
        | "tab"
        | "escape"
        | "interrupt"
        | "eof";
    };

const pasteStart = "\x1b[200~";
const pasteEnd = "\x1b[201~";

const sequences: Record<string, KeyEvent["type"]> = {
  "\x1b[A": "up",
  "\x1b[B": "down",
  "\x1b[C": "right",
  "\x1b[D": "left",
  "\x1bOA": "up",
  "\x1bOB": "down",
  "\x1bOC": "right",
  "\x1bOD": "left",
  "\x1b[H": "home",
  "\x1b[F": "end",
  "\x1bOH": "home",
  "\x1bOF": "end",
  "\x1b[1~": "home",
  "\x1b[4~": "end",
  "\x1b[3~": "delete",
  "\x1b[1;5D": "word-left",
  "\x1b[1;5C": "word-right",
  "\x1b[1;3D": "word-left",
  "\x1b[1;3C": "word-right",
  "\x1bb": "word-left",
  "\x1bf": "word-right",
  "\x1b\r": "newline",
  "\x1b\n": "newline",
  "\x1b\x7f": "delete-word",
};

const controls: Record<string, KeyEvent["type"]> = {
  "\r": "enter",
  "\n": "newline",
  "\x7f": "backspace",
  "\b": "backspace",
  "\t": "tab",
  "\x03": "interrupt",
  "\x04": "eof",
  "\x01": "home",
  "\x05": "end",
  "\x02": "left",
  "\x06": "right",
  "\x10": "up",
  "\x0e": "down",
  "\x15": "clear-line",
  "\x0b": "kill-to-end",
  "\x17": "delete-word",
};

/**
 * Stateful decoder: escape sequences and pastes can arrive split across
 * chunks. Call `flush` after a short pause to emit a lone Escape.
 */
export class InputDecoder {
  private buffer = "";
  private paste: string | undefined;

  push(chunk: string): KeyEvent[] {
    this.buffer += chunk;
    const events: KeyEvent[] = [];
    let text = "";
    const emitText = () => {
      if (text) events.push({ type: "text", text });
      text = "";
    };
    while (this.buffer) {
      if (this.paste !== undefined) {
        const end = this.buffer.indexOf(pasteEnd);
        if (end < 0) {
          // Keep a possible partial end marker for the next chunk.
          const keep = partialSuffix(this.buffer, pasteEnd);
          this.paste += this.buffer.slice(0, this.buffer.length - keep);
          this.buffer = this.buffer.slice(this.buffer.length - keep);
          return events;
        }
        this.paste += this.buffer.slice(0, end);
        events.push({ type: "paste", text: this.paste });
        this.paste = undefined;
        this.buffer = this.buffer.slice(end + pasteEnd.length);
        continue;
      }
      const head = this.buffer[0] ?? "";
      if (head === "\x1b") {
        if (this.buffer.startsWith(pasteStart)) {
          emitText();
          this.paste = "";
          this.buffer = this.buffer.slice(pasteStart.length);
          continue;
        }
        const match = Object.keys(sequences)
          .filter((sequence) => this.buffer.startsWith(sequence))
          .sort((left, right) => right.length - left.length)[0];
        if (match) {
          emitText();
          events.push({ type: sequences[match] } as KeyEvent);
          this.buffer = this.buffer.slice(match.length);
          continue;
        }
        const unknown = this.buffer.match(
          // biome-ignore lint/suspicious/noControlCharactersInRegex: escape sequence grammar
          /^\x1b(?:\[[0-?]*[ -/]*[@-~]|O.|[^[O])/,
        );
        if (unknown) {
          emitText();
          this.buffer = this.buffer.slice(unknown[0].length);
          continue;
        }
        // Incomplete sequence (or a lone Escape): wait for more or a flush.
        emitText();
        return events;
      }
      const control = controls[head];
      if (control) {
        emitText();
        events.push({ type: control } as KeyEvent);
        this.buffer = this.buffer.slice(1);
        continue;
      }
      const codePoint = head.codePointAt(0) ?? 0;
      if (codePoint < 0x20) {
        this.buffer = this.buffer.slice(1);
        continue;
      }
      text += head;
      this.buffer = this.buffer.slice(1);
    }
    emitText();
    return events;
  }

  /** Emits a pending lone Escape once no continuation arrived. */
  flush(): KeyEvent[] {
    if (this.paste !== undefined || !this.buffer.startsWith("\x1b")) return [];
    const rest = this.buffer.slice(1);
    this.buffer = "";
    return [{ type: "escape" }, ...this.push(rest)];
  }

  get pending(): boolean {
    return this.buffer.length > 0 && this.paste === undefined;
  }
}

function partialSuffix(text: string, marker: string): number {
  for (
    let length = Math.min(marker.length - 1, text.length);
    length > 0;
    length--
  )
    if (marker.startsWith(text.slice(text.length - length))) return length;
  return 0;
}
