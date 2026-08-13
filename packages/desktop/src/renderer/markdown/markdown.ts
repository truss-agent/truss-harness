import hljs from "highlight.js/lib/common";

export type MarkdownBlock =
  | {
      readonly kind: "code";
      readonly language: string;
      readonly content: string;
    }
  | {
      readonly kind: "heading";
      readonly level: 1 | 2 | 3 | 4;
      readonly content: string;
    }
  | { readonly kind: "list"; readonly items: readonly string[] }
  | { readonly kind: "quote"; readonly content: string }
  | { readonly kind: "paragraph"; readonly content: string };

export interface MarkdownRendererOptions {
  readonly document: Document;
  readonly resolveWorkspaceFile: (path: string) => string | undefined;
  readonly openWorkspaceFile: (path: string) => void;
}

export function parseMarkdownBlocks(content: string): readonly MarkdownBlock[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  for (let index = 0; index < lines.length; ) {
    const line = lines[index];
    const fence = line.match(/^```([^\s]*)\s*$/);
    if (fence) {
      const language = fence[1] || "text";
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index]))
        code.push(lines[index++]);
      if (index < lines.length) index += 1;
      blocks.push({ kind: "code", language, content: code.join("\n") });
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1].length as 1 | 2 | 3 | 4,
        content: heading[2],
      });
      index += 1;
      continue;
    }
    if (/^[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*+]\s+/.test(lines[index]))
        items.push(lines[index++].replace(/^[-*+]\s+/, ""));
      blocks.push({ kind: "list", items });
      continue;
    }
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      blocks.push({ kind: "quote", content: quote[1] });
      index += 1;
      continue;
    }
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const paragraph = [line];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(#{1,4}\s|```|[-*+]\s+|>\s?)/.test(lines[index])
    )
      paragraph.push(lines[index++]);
    blocks.push({ kind: "paragraph", content: paragraph.join("\n") });
  }
  return blocks;
}

export function isExternalMarkdownLink(value: string): boolean {
  return /^(https?:|mailto:)/i.test(value);
}

export function highlightedLanguage(language: string): string | undefined {
  const aliases: Readonly<Record<string, string>> = {
    html: "xml",
    shell: "bash",
    sh: "bash",
    tsx: "typescript",
    jsx: "javascript",
    vue: "xml",
    svelte: "xml",
    svg: "xml",
    yml: "yaml",
  };
  const resolved = aliases[language.toLowerCase()] ?? language.toLowerCase();
  return !resolved || resolved === "text" || !hljs.getLanguage(resolved)
    ? undefined
    : resolved;
}

export function appendHighlightedCode(
  parent: HTMLElement,
  code: string,
  language = "",
  document = parent.ownerDocument,
): void {
  const resolved = highlightedLanguage(language);
  if (!resolved) {
    parent.textContent = code;
    return;
  }
  // highlight.js escapes source before producing its token spans.
  const template = document.createElement("template");
  template.innerHTML = hljs.highlight(code, {
    language: resolved,
    ignoreIllegals: true,
  }).value;
  parent.replaceChildren(template.content);
}

export function createMarkdownRenderer(
  options: MarkdownRendererOptions,
): (container: HTMLElement, content: string) => void {
  const appendFileReference = (
    parent: HTMLElement,
    path: string,
    label = path,
  ): void => {
    const button = options.document.createElement("button");
    button.type = "button";
    button.className = "chat-file-link";
    button.textContent = label;
    button.title = `Open ${path}`;
    button.onclick = () => options.openWorkspaceFile(path);
    parent.append(button);
  };

  const appendTextWithFileReferences = (
    parent: HTMLElement,
    text: string,
  ): void => {
    const filePath =
      /(?:\.{1,2}\/)?(?:[A-Za-z0-9_@.-]+\/)*(?:[A-Za-z0-9_-]+\.[A-Za-z0-9][A-Za-z0-9_.-]*|\.[A-Za-z0-9_-]+)/g;
    let cursor = 0;
    for (const match of text.matchAll(filePath)) {
      const index = match.index ?? 0;
      const reference = options.resolveWorkspaceFile(match[0]);
      if (!reference) continue;
      if (index > cursor)
        parent.append(
          options.document.createTextNode(text.slice(cursor, index)),
        );
      appendFileReference(parent, reference, match[0]);
      cursor = index + match[0].length;
    }
    if (cursor < text.length)
      parent.append(options.document.createTextNode(text.slice(cursor)));
  };

  const appendInline = (parent: HTMLElement, text: string): void => {
    const token =
      /(`[^`]*`)|(\[([^\]]+)\]\(([^\s)]+)\))|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)/g;
    let cursor = 0;
    for (const match of text.matchAll(token)) {
      const index = match.index ?? 0;
      if (index > cursor)
        appendTextWithFileReferences(parent, text.slice(cursor, index));
      if (match[1]) {
        const codeText = match[1].slice(1, -1);
        const reference = options.resolveWorkspaceFile(codeText);
        if (reference) appendFileReference(parent, reference, codeText);
        else {
          const code = options.document.createElement("code");
          code.textContent = codeText;
          parent.append(code);
        }
      } else if (match[2]) {
        const href = match[4] ?? "";
        const reference = options.resolveWorkspaceFile(href);
        if (reference)
          appendFileReference(parent, reference, match[3] ?? reference);
        else {
          const link = options.document.createElement("a");
          link.textContent = match[3] ?? href;
          if (isExternalMarkdownLink(href)) {
            link.href = href;
            link.target = "_blank";
            link.rel = "noreferrer";
          }
          parent.append(link);
        }
      } else if (match[5]) {
        const strong = options.document.createElement("strong");
        strong.textContent = match[6] ?? "";
        parent.append(strong);
      } else if (match[7]) {
        const emphasis = options.document.createElement("em");
        emphasis.textContent = match[8] ?? "";
        parent.append(emphasis);
      }
      cursor = index + match[0].length;
    }
    if (cursor < text.length)
      appendTextWithFileReferences(parent, text.slice(cursor));
  };

  return (container, content): void => {
    for (const block of parseMarkdownBlocks(content)) {
      if (block.kind === "code") {
        const view = options.document.createElement("div");
        view.className = "code-block";
        const label = options.document.createElement("div");
        label.className = "code-language";
        label.textContent = block.language;
        const pre = options.document.createElement("pre");
        const code = options.document.createElement("code");
        appendHighlightedCode(
          code,
          block.content,
          block.language,
          options.document,
        );
        pre.append(code);
        view.append(label, pre);
        container.append(view);
        continue;
      }
      if (block.kind === "heading") {
        const heading = options.document.createElement(`h${block.level}`);
        appendInline(heading, block.content);
        container.append(heading);
        continue;
      }
      if (block.kind === "list") {
        const list = options.document.createElement("ul");
        for (const content of block.items) {
          const item = options.document.createElement("li");
          appendInline(item, content);
          list.append(item);
        }
        container.append(list);
        continue;
      }
      if (block.kind === "quote") {
        const quote = options.document.createElement("blockquote");
        appendInline(quote, block.content);
        container.append(quote);
        continue;
      }
      const paragraph = options.document.createElement("p");
      appendInline(paragraph, block.content);
      container.append(paragraph);
    }
  };
}
