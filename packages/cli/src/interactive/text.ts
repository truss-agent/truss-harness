/**
 * Terminal-safe text helpers. Model, tool and file text can contain escape
 * sequences; they are stripped before anything reaches the terminal.
 */

// CSI, OSC (BEL or ST terminated), other escapes, then remaining C0/C1 controls.
const escapeSequences =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching terminal controls is the point
  /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[PX^_][^\x1b]*(?:\x1b\\)?|\x1b[@-Z\\-_]?|[\x00-\x08\x0b-\x1f\x7f\x80-\x9f]/g;

/** Removes terminal control sequences, keeping newlines and tabs as spaces. */
export function sanitize(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(escapeSequences, "")
    .replace(/\t/g, "  ");
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function graphemes(text: string): string[] {
  return Array.from(segmenter.segment(text), (part) => part.segment);
}

/** Cursor index (UTF-16) of the grapheme boundary before `index`. */
export function previousBoundary(text: string, index: number): number {
  let previous = 0;
  for (const { index: start } of segmenter.segment(text)) {
    if (start >= index) break;
    previous = start;
  }
  return previous;
}

/** Cursor index (UTF-16) of the grapheme boundary after `index`. */
export function nextBoundary(text: string, index: number): number {
  for (const { index: start, segment } of segmenter.segment(text))
    if (start >= index) return start + segment.length;
  return text.length;
}

function isWide(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
}

/** Terminal columns a grapheme occupies: 0, 1 or 2. */
export function graphemeWidth(grapheme: string): number {
  const codePoint = grapheme.codePointAt(0) ?? 0;
  if (codePoint === 0 || /^\p{Mn}+$/u.test(grapheme)) return 0;
  if (grapheme.includes("\u{FE0F}") || isWide(codePoint)) return 2;
  return 1;
}

export function displayWidth(text: string): number {
  let width = 0;
  for (const grapheme of graphemes(text)) width += graphemeWidth(grapheme);
  return width;
}

/** Splits text into rows of at most `width` columns, breaking at graphemes. */
export function wrap(text: string, width: number): string[] {
  const columns = Math.max(1, width);
  const rows: string[] = [];
  for (const line of text.split("\n")) {
    let row = "";
    let used = 0;
    for (const grapheme of graphemes(line)) {
      const size = graphemeWidth(grapheme);
      if (used + size > columns) {
        rows.push(row);
        row = "";
        used = 0;
      }
      row += grapheme;
      used += size;
    }
    rows.push(row);
  }
  return rows;
}

/** Shortens text to `width` columns with a trailing ellipsis. */
export function truncate(text: string, width: number): string {
  if (displayWidth(text) <= width) return text;
  let result = "";
  let used = 0;
  for (const grapheme of graphemes(text)) {
    const size = graphemeWidth(grapheme);
    if (used + size > width - 1) break;
    result += grapheme;
    used += size;
  }
  return `${result}…`;
}
