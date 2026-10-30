import type { Style } from "./renderer.js";
import { displayWidth, sanitize, truncate, wrapStyled } from "./text.js";

/**
 * Renders a whole fenced block of one language, such as a diagram or math,
 * instead of showing its source. Output rows may contain our style codes.
 */
export interface FenceRenderer {
  readonly languages: readonly string[];
  render(source: string, width: number, style: Style): readonly string[];
}

export interface MarkdownRendererOptions {
  readonly style: Style;
  readonly width: () => number;
  readonly fences?: readonly FenceRenderer[];
}

interface OpenFence {
  readonly marker: string;
  readonly language: string;
  readonly renderer?: FenceRenderer;
  readonly lines: string[];
}

type Alignment = "left" | "right" | "center";

const bullets = ["•", "◦", "▪"];
const plainLanguages = new Set(["", "text", "txt", "plain", "markdown", "md"]);
const hashComments = new Set([
  "py",
  "python",
  "sh",
  "bash",
  "zsh",
  "shell",
  "console",
  "yaml",
  "yml",
  "toml",
  "rb",
  "ruby",
  "r",
  "perl",
  "dockerfile",
  "makefile",
  "ini",
  "conf",
]);
const dashComments = new Set(["sql", "lua", "haskell", "hs"]);
const keywords = new Set(
  (
    "abstract as async await break case catch class const continue def defer " +
    "del do elif else enum except export extends false final finally fn for " +
    "from func function go if impl implements import in interface lambda let " +
    "match mut new nil none None not null of or package pass private protected " +
    "pub public raise readonly return select self Self static struct super " +
    "switch this throw true True False try type typeof undefined use var void " +
    "where while with yield and"
  ).split(" "),
);

/**
 * Streaming Markdown for the terminal. Complete source lines go in; rendered
 * rows come out. Tables and registered fences are held until they end.
 */
export class MarkdownRenderer {
  private fence: OpenFence | undefined;
  private table: string[] = [];

  constructor(private readonly options: MarkdownRendererOptions) {}

  push(raw: string): string[] {
    const line = sanitize(raw);
    if (this.fence) return this.inFence(line);
    if (/^\s*\|.*\|\s*$/.test(line)) {
      this.table.push(line);
      return [];
    }
    const rows = this.flushTable();
    const open = line.match(/^\s*(`{3,}|~{3,})\s*([\w+#.-]*)/);
    if (open) {
      const language = (open[2] ?? "").toLowerCase();
      this.fence = {
        marker: open[1] ?? "```",
        language,
        renderer: this.options.fences?.find((renderer) =>
          renderer.languages.includes(language),
        ),
        lines: [],
      };
      if (!this.fence.renderer)
        rows.push(
          this.options.style.dim(`  ┌${language ? ` ${language}` : ""}`),
        );
      return rows;
    }
    return [...rows, ...this.block(line)];
  }

  /** The stream paused or ended: emit anything held back. */
  end(): string[] {
    const rows = this.flushTable();
    const fence = this.fence;
    this.fence = undefined;
    if (fence?.renderer)
      rows.push(...fence.lines.map((line) => this.codeLine(line, "")));
    return rows;
  }

  reset(): void {
    this.fence = undefined;
    this.table = [];
  }

  private get width(): number {
    return Math.max(10, this.options.width());
  }

  private inFence(line: string): string[] {
    const fence = this.fence as OpenFence;
    const trimmed = line.trim();
    const closes =
      trimmed.length >= fence.marker.length &&
      trimmed === (fence.marker[0] ?? "`").repeat(trimmed.length);
    if (!closes) {
      if (fence.renderer) {
        fence.lines.push(line);
        return [];
      }
      return [this.codeLine(line, fence.language)];
    }
    this.fence = undefined;
    if (!fence.renderer) return [this.options.style.dim("  └")];
    return fence.renderer
      .render(fence.lines.join("\n"), this.width, this.options.style)
      .flatMap((row) => row.split("\n"));
  }

  private codeLine(line: string, language: string): string {
    return `  ${this.options.style.accent("│")} ${highlight(line, language, this.options.style)}`;
  }

  private block(line: string): string[] {
    const { style } = this.options;
    if (!line.trim()) return [""];
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line))
      return [style.dim("─".repeat(Math.min(this.width, 80)))];
    const heading = line.match(/^\s*(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      const text = inline(heading[2] ?? "", style);
      return this.wrap(
        heading[1] === "#" ? style.bold(style.accent(text)) : style.bold(text),
        "",
        "",
      );
    }
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      const bar = style.dim("│ ");
      return this.wrap(inline(quote[1] ?? "", style), bar, bar);
    }
    const item = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (item) {
      const level = Math.floor((item[1] ?? "").length / 2);
      const indent = "  ".repeat(level);
      let marker = /\d/.test(item[2] ?? "")
        ? (item[2] ?? "")
        : style.accent(bullets[level % bullets.length] ?? "•");
      let text = item[3] ?? "";
      const task = text.match(/^\[([ xX])\]\s+(.*)$/);
      if (task) {
        marker = task[1] === " " ? "☐" : style.success("☑");
        text = task[2] ?? "";
      }
      const first = `${indent}${marker} `;
      return this.wrap(
        inline(text, style),
        first,
        " ".repeat(displayWidth(stripStyle(first))),
      );
    }
    const indent = line.match(/^\s*/)?.[0] ?? "";
    return this.wrap(inline(line.trim(), style), indent, indent);
  }

  private wrap(text: string, first: string, rest: string): string[] {
    const inner = this.width - displayWidth(stripStyle(first));
    return wrapStyled(text, inner).map(
      (row, index) => `${index === 0 ? first : rest}${row}`,
    );
  }

  private flushTable(): string[] {
    const lines = this.table;
    this.table = [];
    return lines.length ? this.renderTable(lines) : [];
  }

  private renderTable(lines: readonly string[]): string[] {
    const { style } = this.options;
    let rows = lines.map(cells);
    let alignments: Alignment[] = [];
    let header: string[] | undefined;
    if (rows.length > 1 && isSeparator(rows[1] ?? [])) {
      header = rows[0];
      alignments = (rows[1] ?? []).map(alignment);
      rows = rows.slice(2);
    }
    const count = Math.max(
      header?.length ?? 0,
      ...rows.map((row) => row.length),
    );
    const styled = (row: readonly string[], bold: boolean) =>
      Array.from({ length: count }, (_, index) => {
        const text = inline(row[index] ?? "", style);
        return bold ? style.bold(text) : text;
      });
    const head = header ? styled(header, true) : undefined;
    const body = rows.map((row) => styled(row, false));
    const widths = Array.from({ length: count }, (_, index) =>
      Math.max(
        1,
        ...[head, ...body].map((row) =>
          row ? displayWidth(stripStyle(row[index] ?? "")) : 0,
        ),
      ),
    );
    // Borders and padding take 3 columns per cell plus one.
    const available = this.width - (3 * count + 1);
    while (widths.reduce((sum, width) => sum + width, 0) > available) {
      const widest = widths.indexOf(Math.max(...widths));
      if ((widths[widest] ?? 0) <= 3) break;
      widths[widest] = (widths[widest] ?? 0) - 1;
    }
    const rule = (left: string, middle: string, right: string) =>
      style.dim(
        `${left}${widths.map((width) => "─".repeat(width + 2)).join(middle)}${right}`,
      );
    const bar = style.dim("│");
    const line = (row: readonly string[]) =>
      `${bar}${row
        .map(
          (cell, index) =>
            ` ${fit(cell, widths[index] ?? 1, alignments[index] ?? "left")} `,
        )
        .join(bar)}${bar}`;
    return [
      rule("┌", "┬", "┐"),
      ...(head ? [line(head), rule("├", "┼", "┤")] : []),
      ...body.map(line),
      rule("└", "┴", "┘"),
    ];
  }
}

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function isSeparator(row: readonly string[]): boolean {
  return row.length > 0 && row.every((cell) => /^:?-+:?$/.test(cell));
}

function alignment(cell: string): Alignment {
  if (cell.startsWith(":") && cell.endsWith(":")) return "center";
  return cell.endsWith(":") ? "right" : "left";
}

function fit(cell: string, width: number, align: Alignment): string {
  const visible = displayWidth(stripStyle(cell));
  // Truncation drops styling; a cut cell is plain text.
  const text = visible > width ? truncate(stripStyle(cell), width) : cell;
  const gap = Math.max(0, width - displayWidth(stripStyle(text)));
  if (align === "right") return `${" ".repeat(gap)}${text}`;
  if (align === "center") {
    const left = Math.floor(gap / 2);
    return `${" ".repeat(left)}${text}${" ".repeat(gap - left)}`;
  }
  return `${text}${" ".repeat(gap)}`;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: our own SGR codes
const styleCodes = /\x1b\[[0-9;]*m/g;

function stripStyle(text: string): string {
  return text.replace(styleCodes, "");
}

/** Inline Markdown: code spans and links first, so their text stays literal. */
export function inline(text: string, style: Style): string {
  const held: string[] = [];
  const hold = (value: string) => `\uE000${held.push(value) - 1}\uE000`;
  return text
    .replace(/`([^`]+)`/g, (_, code: string) => hold(style.accent(code)))
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, url: string) =>
      hold(
        label === url
          ? style.underline(url)
          : `${style.underline(label)}${style.dim(` (${url})`)}`,
      ),
    )
    .replace(/<(https?:\/\/[^>\s]+)>/g, (_, url: string) =>
      hold(style.underline(url)),
    )
    .replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_, star?: string, under?: string) =>
      style.bold(star ?? under ?? ""),
    )
    .replace(/~~(.+?)~~/g, (_, value: string) => style.strike(value))
    .replace(
      /(^|[^\w*])\*(?!\s)([^*]+?)\*(?!\w)/g,
      (_, before: string, value: string) => `${before}${style.italic(value)}`,
    )
    .replace(
      /(^|[^\w])_(?!\s)([^_]+?)_(?!\w)/g,
      (_, before: string, value: string) => `${before}${style.italic(value)}`,
    )
    .replace(
      /\uE000(\d+)\uE000/g,
      (_, index: string) => held[Number(index)] ?? "",
    );
}

/** Light, language-agnostic coloring: comments, strings, numbers, keywords. */
export function highlight(
  line: string,
  language: string,
  style: Style,
): string {
  if (plainLanguages.has(language)) return line;
  if (language === "diff" || language === "patch") {
    if (line.startsWith("+")) return style.success(line);
    if (line.startsWith("-")) return style.error(line);
    if (line.startsWith("@@")) return style.accent(line);
    return line;
  }
  const comment = hashComments.has(language)
    ? "#.*$"
    : dashComments.has(language)
      ? "--.*$"
      : "\\/\\/.*$|\\/\\*.*?(?:\\*\\/|$)";
  const pattern = new RegExp(
    `(${comment})|("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|\`(?:[^\`\\\\]|\\\\.)*\`)|\\b(\\d[\\d_]*(?:\\.\\d+)?)\\b|\\b([A-Za-z_]\\w*)\\b`,
    "g",
  );
  return line.replace(
    pattern,
    (match, note?: string, string?: string, number?: string, word?: string) => {
      if (note) return style.dim(note);
      if (string) return style.success(string);
      if (number) return style.warning(number);
      if (word && keywords.has(word)) return style.highlight(word);
      return match;
    },
  );
}
