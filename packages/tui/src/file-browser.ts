import { extname } from "node:path";

export interface FileEntry {
  readonly path: string;
}

export interface FileTreeEntry {
  readonly kind: "directory" | "file";
  readonly path: string;
  readonly name: string;
  readonly depth: number;
  readonly expanded?: boolean;
}

interface DirectoryNode {
  readonly directories: Map<string, DirectoryNode>;
  readonly files: FileEntry[];
}

export interface SyntaxToken {
  readonly text: string;
  readonly color?: "blue" | "cyan" | "gray" | "green" | "magenta" | "red" | "yellow";
  readonly dim?: boolean;
}

export function buildFileTree(files: readonly FileEntry[], collapsed: ReadonlySet<string>): readonly FileTreeEntry[] {
  const root: DirectoryNode = { directories: new Map(), files: [] };
  for (const file of files) {
    const parts = file.path.replaceAll("\\", "/").split("/").filter(Boolean);
    const fileName = parts.pop();
    if (!fileName) continue;
    let node = root;
    for (const part of parts) {
      let child = node.directories.get(part);
      if (!child) {
        child = { directories: new Map(), files: [] };
        node.directories.set(part, child);
      }
      node = child;
    }
    node.files.push({ path: [...parts, fileName].join("/") });
  }

  const result: FileTreeEntry[] = [];
  const append = (node: DirectoryNode, parentPath: string, depth: number): void => {
    const directories = [...node.directories.entries()].sort(([left], [right]) => left.localeCompare(right));
    for (const [name, child] of directories) {
      const path = parentPath ? `${parentPath}/${name}` : name;
      const expanded = !collapsed.has(path);
      result.push({ kind: "directory", path, name, depth, expanded });
      if (expanded) append(child, path, depth + 1);
    }
    for (const file of [...node.files].sort((left, right) => left.path.localeCompare(right.path))) {
      result.push({
        kind: "file",
        path: file.path,
        name: file.path.split("/").at(-1) ?? file.path,
        depth
      });
    }
  };
  append(root, "", 0);
  return result;
}

export function fuzzyScore(path: string, query: string): number | undefined {
  const target = path.toLocaleLowerCase();
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return 0;
  let position = 0;
  let score = 0;
  for (const character of needle) {
    const next = target.indexOf(character, position);
    if (next === -1) return undefined;
    score += next - position;
    position = next + 1;
  }
  const fileName = target.split("/").at(-1) ?? target;
  if (fileName.startsWith(needle)) score -= 60;
  else if (fileName.includes(needle)) score -= 35;
  else if (target.includes(needle)) score -= 20;
  return score + path.length / 1_000;
}

export function fuzzyFiles(files: readonly FileEntry[], query: string, limit = 12): readonly FileEntry[] {
  return files
    .flatMap((file) => {
      const score = fuzzyScore(file.path, query);
      return score === undefined ? [] : [{ file, score }];
    })
    .sort((left, right) => left.score - right.score || left.file.path.localeCompare(right.file.path))
    .slice(0, limit)
    .map(({ file }) => file);
}

const codeExtensions = new Set([".c", ".cc", ".cpp", ".cs", ".go", ".java", ".js", ".jsx", ".kt", ".mjs", ".php", ".py", ".rb", ".rs", ".sh", ".ts", ".tsx"]);
const markupExtensions = new Set([".html", ".htm", ".svg", ".vue", ".svelte", ".xml"]);
const dataExtensions = new Set([".json", ".jsonc", ".yaml", ".yml", ".toml"]);
function tokenize(line: string, pattern: RegExp, colors: readonly SyntaxToken["color"][]): readonly SyntaxToken[] {
  const result: SyntaxToken[] = [];
  let cursor = 0;
  for (const match of line.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) result.push({ text: line.slice(cursor, index) });
    const group = match.slice(1).findIndex((value) => value !== undefined);
    result.push({ text: match[0], color: colors[Math.max(0, group)], dim: group === 0 });
    cursor = index + match[0].length;
  }
  if (cursor < line.length) result.push({ text: line.slice(cursor) });
  return result.length ? result : [{ text: line }];
}

export function syntaxTokens(line: string, path: string): readonly SyntaxToken[] {
  const extension = extname(path).toLowerCase();
  if (markupExtensions.has(extension)) {
    return tokenize(line, /(<!--.*?-->)|(<\/?[A-Za-z][^>]*>)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g, ["gray", "cyan", "green"]);
  }
  if (extension === ".md" || extension === ".mdx") {
    return tokenize(line, /(^\s*#{1,6}\s.*$)|(`[^`]*`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))/g, ["cyan", "green", "yellow", "blue"]);
  }
  if (dataExtensions.has(extension)) {
    return tokenize(line, /(^\s*(?:#|\/\/).*$)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|\b(true|false|null)\b|(-?\b\d+(?:\.\d+)?\b)|([{}[\],:=])/g, ["gray", "green", "magenta", "yellow", "cyan"]);
  }
  if (codeExtensions.has(extension)) {
    const comment = extension === ".py" || extension === ".rb" || extension === ".sh"
      ? /(#.*$)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b(?:as|async|await|break|case|catch|class|const|continue|def|default|delete|do|else|enum|export|extends|false|finally|fn|for|from|function|if|implements|import|in|instanceof|interface|let|match|new|null|package|private|protected|public|return|static|struct|super|switch|this|throw|true|try|type|typeof|undefined|use|var|void|while|yield)\b)|(\b(?:0x[\da-f]+|\d+(?:\.\d+)?)\b)|([{}()[\].,:;=+\-*/<>!?&|]+)/gi
      : /(\/\/.*$)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b(?:as|async|await|break|case|catch|class|const|continue|def|default|delete|do|else|enum|export|extends|false|finally|fn|for|from|function|if|implements|import|in|instanceof|interface|let|match|new|null|package|private|protected|public|return|static|struct|super|switch|this|throw|true|try|type|typeof|undefined|use|var|void|while|yield)\b)|(\b(?:0x[\da-f]+|\d+(?:\.\d+)?)\b)|([{}()[\].,:;=+\-*/<>!?&|]+)/gi;
    return tokenize(line, comment, ["gray", "green", "magenta", "yellow", "cyan"]);
  }
  return [{ text: line }];
}

export function clipSyntaxTokens(tokens: readonly SyntaxToken[], maximumCharacters: number): readonly SyntaxToken[] {
  const result: SyntaxToken[] = [];
  let remaining = Math.max(0, maximumCharacters);
  for (const token of tokens) {
    if (!remaining) break;
    const text = token.text.slice(0, remaining);
    if (text) result.push({ ...token, text });
    remaining -= text.length;
  }
  return result;
}

export function wrapSyntaxTokens(tokens: readonly SyntaxToken[], maximumCharacters: number): readonly (readonly SyntaxToken[])[] {
  const width = Math.max(1, maximumCharacters);
  const rows: SyntaxToken[][] = [[]];
  let rowLength = 0;
  for (const token of tokens) {
    let remaining = token.text;
    if (!remaining && rows.length === 1 && !rows[0].length) rows[0].push(token);
    while (remaining) {
      const available = width - rowLength;
      if (!available) {
        rows.push([]);
        rowLength = 0;
        continue;
      }
      const text = remaining.slice(0, available);
      rows.at(-1)?.push({ ...token, text });
      rowLength += text.length;
      remaining = remaining.slice(text.length);
    }
  }
  return rows;
}
