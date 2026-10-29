import { readFile } from "node:fs/promises";
import type { Session, ToolApproval, ToolCall } from "@truss-harness/runtime";
import { CliToolApproval } from "../cli-approval.js";
import type { PermissionMode } from "../protocol.js";
import type { Style } from "./renderer.js";
import { sanitize, truncate } from "./text.js";

const maxDiffLines = 400;
const maxPreviewRows = 40;

/** Line diff for previews; falls back to replace-all on very large inputs. */
export function lineDiff(before: string, after: string): string[] {
  const left = before === "" ? [] : before.split("\n");
  const right = after === "" ? [] : after.split("\n");
  if (left.length > maxDiffLines || right.length > maxDiffLines)
    return [
      ...left.map((line) => `-${line}`),
      ...right.map((line) => `+${line}`),
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
  const lines: string[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      lines.push(` ${left[i]}`);
      i++;
      j++;
    } else if (
      j < right.length &&
      (i >= left.length ||
        ((table[i] as number[])[j + 1] ?? 0) >=
          ((table[i + 1] as number[])[j] ?? 0))
    )
      lines.push(`+${right[j++]}`);
    else lines.push(`-${left[i++]}`);
  }
  return lines;
}

/** Keeps changed lines with two lines of context around each change. */
function compact(lines: readonly string[]): string[] {
  const keep = new Set<number>();
  lines.forEach((line, index) => {
    if (line.startsWith(" ")) return;
    for (let offset = -2; offset <= 2; offset++) keep.add(index + offset);
  });
  const result: string[] = [];
  let skipped = false;
  lines.forEach((line, index) => {
    if (keep.has(index)) {
      result.push(line);
      skipped = false;
    } else if (!skipped) {
      result.push("…");
      skipped = true;
    }
  });
  return result;
}

/**
 * What an approval shows: a diff for file edits, the command for terminal
 * runs, and bounded JSON for anything else.
 */
export async function approvalPreview(
  call: ToolCall,
  workspaceRoot: string,
  width: number,
  style: Style,
  read: (path: string) => Promise<string> = (path) => readFile(path, "utf8"),
): Promise<string[]> {
  const input = call.input as Record<string, unknown>;
  const path = typeof input.path === "string" ? input.path : undefined;
  let diff: string[] | undefined;
  if (call.name === "write_file" && path && typeof input.content === "string") {
    const before = await read(resolvePath(workspaceRoot, path)).catch(() => "");
    diff = compact(lineDiff(before, input.content));
  } else if (
    call.name === "replace_in_file" &&
    typeof input.oldText === "string" &&
    typeof input.newText === "string"
  )
    diff = lineDiff(input.oldText, input.newText);
  if (diff) {
    const rows = diff.slice(0, maxPreviewRows).map((line) => {
      const text = truncate(sanitize(line), width - 4);
      return `  ${
        line.startsWith("+")
          ? style.success(text)
          : line.startsWith("-")
            ? style.error(text)
            : style.dim(text)
      }`;
    });
    if (diff.length > maxPreviewRows)
      rows.push(style.dim(`  … ${diff.length - maxPreviewRows} more lines`));
    return rows;
  }
  if (call.name === "run_terminal" && typeof input.command === "string")
    return [
      `  ${style.bold("$")} ${truncate(sanitize(input.command), width - 6)}`,
    ];
  const json = sanitize(JSON.stringify(input, null, 2));
  const rows = json.split("\n");
  return [
    ...rows
      .slice(0, 12)
      .map((row) => `  ${style.dim(truncate(row, width - 4))}`),
    ...(rows.length > 12 ? [style.dim("  …")] : []),
  ];
}

function resolvePath(root: string, path: string): string {
  return path.startsWith("/") ? path : `${root}/${path}`;
}

/**
 * Approval whose permission mode can change between turns. Each mode keeps
 * the fail-closed CliToolApproval behavior; the prompt is the composer.
 */
export class SwitchableApproval implements ToolApproval {
  private current: CliToolApproval;

  constructor(
    private permission: PermissionMode,
    private readonly ask: (
      call: ToolCall,
      signal: AbortSignal,
    ) => Promise<boolean>,
  ) {
    this.current = this.create();
  }

  get mode(): PermissionMode {
    return this.permission;
  }

  set mode(permission: PermissionMode) {
    this.current.denyAll();
    this.permission = permission;
    this.current = this.create();
  }

  approve(
    call: ToolCall,
    session: Session,
    context?: { readonly signal?: AbortSignal },
  ): Promise<boolean> {
    return this.current.approve(call, session, context);
  }

  denyAll(): void {
    this.current.denyAll();
  }

  private create(): CliToolApproval {
    return new CliToolApproval(this.permission, {
      question: async (_label, { signal, call }) =>
        call && (await this.ask(call, signal)) ? "y" : "n",
    });
  }
}
