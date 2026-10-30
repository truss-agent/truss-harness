import { highlight } from "./markdown.js";
import type { Style } from "./renderer.js";
import { displayWidth, sanitize, truncate } from "./text.js";

/** Largest changed region diffed line by line; bigger ones show as replaced. */
const maxDiffLines = 400;
const context = 2;

export interface DiffRow {
  readonly kind: " " | "+" | "-";
  readonly text: string;
  /** 1-based line in the old file (removed and context rows). */
  readonly oldLine: number;
  /** 1-based line in the new file (added and context rows). */
  readonly newLine: number;
}

/** Lines of a file, without the empty entry after a final newline. */
export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** Highlighter language for a file path, from its extension or name. */
export function languageForPath(path: string): string {
  const name = path.split(/[\\/]/).at(-1)?.toLowerCase() ?? "";
  if (name === "dockerfile" || name === "makefile") return name;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1) : "text";
}

/**
 * Numbered line diff. Shared leading and trailing lines are matched first, so
 * a small edit in a large file stays cheap and precise.
 */
export function diffRows(before: string, after: string): DiffRow[] {
  const left = splitLines(before);
  const right = splitLines(after);
  let start = 0;
  while (
    start < left.length &&
    start < right.length &&
    left[start] === right[start]
  )
    start++;
  let end = 0;
  while (
    end < left.length - start &&
    end < right.length - start &&
    left[left.length - 1 - end] === right[right.length - 1 - end]
  )
    end++;
  const rows: DiffRow[] = [];
  let oldLine = 1;
  let newLine = 1;
  const push = (kind: DiffRow["kind"], text: string) => {
    rows.push({ kind, text, oldLine, newLine });
    if (kind !== "+") oldLine++;
    if (kind !== "-") newLine++;
  };
  for (const line of left.slice(0, start)) push(" ", line);
  for (const [kind, text] of middleDiff(
    left.slice(start, left.length - end),
    right.slice(start, right.length - end),
  ))
    push(kind, text);
  for (const line of left.slice(left.length - end)) push(" ", line);
  return rows;
}

function middleDiff(
  left: readonly string[],
  right: readonly string[],
): [DiffRow["kind"], string][] {
  if (left.length > maxDiffLines || right.length > maxDiffLines)
    return [
      ...left.map((line): [DiffRow["kind"], string] => ["-", line]),
      ...right.map((line): [DiffRow["kind"], string] => ["+", line]),
    ];
  const table = Array.from({ length: left.length + 1 }, () =>
    new Array<number>(right.length + 1).fill(0),
  );
  for (let i = left.length - 1; i >= 0; i--)
    for (let j = right.length - 1; j >= 0; j--)
      (table[i] as number[])[j] =
        left[i] === right[j]
          ? ((table[i + 1] as number[])[j + 1] ?? 0) + 1
          : Math.max(
              (table[i + 1] as number[])[j] ?? 0,
              (table[i] as number[])[j + 1] ?? 0,
            );
  const rows: [DiffRow["kind"], string][] = [];
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      rows.push([" ", left[i] as string]);
      i++;
      j++;
    } else if (
      i < left.length &&
      (j >= right.length ||
        ((table[i + 1] as number[])[j] ?? 0) >=
          ((table[i] as number[])[j + 1] ?? 0))
    )
      rows.push(["-", left[i++] as string]);
    else rows.push(["+", right[j++] as string]);
  }
  return rows;
}

/** Changed rows with a little context; `undefined` marks skipped lines. */
export function hunks(rows: readonly DiffRow[]): (DiffRow | undefined)[] {
  const keep = new Set<number>();
  rows.forEach((row, index) => {
    if (row.kind === " ") return;
    for (let offset = -context; offset <= context; offset++)
      keep.add(index + offset);
  });
  const result: (DiffRow | undefined)[] = [];
  let skipped = false;
  rows.forEach((row, index) => {
    if (keep.has(index)) {
      result.push(row);
      skipped = false;
    } else if (!skipped && result.length) {
      result.push(undefined);
      skipped = true;
    }
  });
  if (result.at(-1) === undefined) result.pop();
  return result;
}

export function countChanges(rows: readonly DiffRow[]): {
  readonly additions: number;
  readonly removals: number;
} {
  return {
    additions: rows.filter((row) => row.kind === "+").length,
    removals: rows.filter((row) => row.kind === "-").length,
  };
}

const indent = "    ";

/** Numbered, highlighted diff hunks, at most `limit` rows. */
export function formatDiff(
  rows: readonly DiffRow[],
  path: string,
  width: number,
  style: Style,
  limit = 40,
): string[] {
  const shown = hunks(rows);
  const language = languageForPath(path);
  const digits = String(
    Math.max(1, ...rows.map((row) => Math.max(row.oldLine, row.newLine))),
  ).length;
  const room = Math.max(8, width - indent.length - digits - 3);
  const lines = shown.slice(0, limit).map((row) => {
    if (!row) return `${indent}${style.dim(`${" ".repeat(digits)}   …`)}`;
    const number = String(row.kind === "-" ? row.oldLine : row.newLine);
    const text = truncate(sanitize(row.text), room);
    const code = highlight(text, language, style);
    if (row.kind === " ")
      return `${indent}${style.dim(number.padStart(digits))}   ${code}`;
    const fill = style.color
      ? " ".repeat(Math.max(0, room - displayWidth(text)))
      : "";
    const tint = row.kind === "+" ? style.added : style.removed;
    const sign = row.kind === "+" ? style.success("+") : style.error("-");
    return `${indent}${tint(`${style.dim(number.padStart(digits))} ${sign} ${code}${fill}`)}`;
  });
  if (shown.length > limit)
    lines.push(
      `${indent}${style.dim(`… +${shown.length - limit} more diff lines`)}`,
    );
  return lines;
}

/** The first `limit` lines of a file, numbered and highlighted. */
export function formatCode(
  content: string,
  path: string,
  width: number,
  style: Style,
  limit = 10,
): string[] {
  const all = splitLines(content);
  const language = languageForPath(path);
  const digits = String(Math.min(all.length, limit)).length;
  const room = Math.max(8, width - indent.length - digits - 1);
  const lines = all
    .slice(0, limit)
    .map(
      (line, index) =>
        `${indent}${style.dim(String(index + 1).padStart(digits))} ${highlight(
          truncate(sanitize(line), room),
          language,
          style,
        )}`,
    );
  if (all.length > limit)
    lines.push(`${indent}${style.dim(`… +${all.length - limit} lines`)}`);
  return lines;
}

/**
 * File contents after a write or edit tool runs on `before`, or `undefined`
 * when the edit can't be reproduced exactly (the tool reports that itself).
 */
export function editedContent(
  tool: string,
  input: Readonly<Record<string, unknown>>,
  before: string,
): string | undefined {
  if (tool === "write_file")
    return typeof input.content === "string" ? input.content : undefined;
  if (
    tool !== "replace_in_file" ||
    typeof input.oldText !== "string" ||
    typeof input.newText !== "string"
  )
    return undefined;
  if (before.trim() === "") return input.newText;
  const unix = before.replace(/\r\n/g, "\n");
  const oldText = input.oldText.replace(/\r\n/g, "\n");
  const index = unix.indexOf(oldText);
  if (oldText === "" || index < 0 || unix.indexOf(oldText, index + 1) >= 0)
    return undefined;
  return `${unix.slice(0, index)}${input.newText.replace(/\r\n/g, "\n")}${unix.slice(index + oldText.length)}`;
}

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

/** "Wrote N lines to path" or "Updated path with A additions and R removals". */
export function editSummary(
  path: string,
  before: string | undefined,
  after: string,
  style: Style,
): string {
  const file = style.bold(sanitize(path));
  if (!before)
    return `Wrote ${plural(splitLines(after).length, "line")} to ${file}`;
  const { additions, removals } = countChanges(diffRows(before, after));
  return `Updated ${file} with ${plural(additions, "addition")} and ${plural(removals, "removal")}`;
}
