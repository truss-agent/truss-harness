import { readFile } from "node:fs/promises";
import type { Session, ToolApproval, ToolCall } from "@truss-harness/runtime";
import { CliToolApproval } from "../cli-approval.js";
import type { PermissionMode } from "../protocol.js";
import { diffRows, editedContent, formatDiff } from "./code-preview.js";
import type { Style } from "./renderer.js";
import { sanitize, truncate } from "./text.js";

const maxPreviewRows = 40;

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
  if (path && (call.name === "write_file" || call.name === "replace_in_file")) {
    const before = await read(resolvePath(workspaceRoot, path)).catch(() => "");
    const after = editedContent(call.name, input, before);
    const rows =
      after !== undefined
        ? diffRows(before, after)
        : typeof input.oldText === "string" && typeof input.newText === "string"
          ? diffRows(input.oldText, input.newText)
          : undefined;
    if (rows) return formatDiff(rows, path, width, style, maxPreviewRows);
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

export function resolvePath(root: string, path: string): string {
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
    /** Remembered "always allow" answers, checked before asking. */
    private readonly remembered: (call: ToolCall) => Promise<boolean> = () =>
      Promise.resolve(false),
    /** Runs after a call is approved, right before it executes. */
    private readonly approved: (call: ToolCall) => Promise<void> = () =>
      Promise.resolve(),
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

  async approve(
    call: ToolCall,
    session: Session,
    context?: { readonly signal?: AbortSignal },
  ): Promise<boolean> {
    context?.signal?.throwIfAborted();
    const allowed =
      (await this.remembered(call)) ||
      (await this.current.approve(call, session, context));
    if (allowed) await this.approved(call);
    return allowed;
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
