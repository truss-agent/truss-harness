import type { Interface } from "node:readline/promises";
import type {
  AgentRuntime,
  Session,
  ToolApproval,
  ToolCall,
} from "@truss-harness/runtime";
import type { PermissionMode } from "./protocol.js";

export interface CliApprovalPrompt {
  question(
    label: string,
    options: {
      readonly signal: AbortSignal;
      /** The call being approved, for prompts that render their own preview. */
      readonly call?: ToolCall;
    },
  ): Promise<string>;
}
const readOnlyTools = new Set([
  "read_file",
  "list_directory",
  "search_files",
  "grep",
]);

/** Uses the caller's single stdin owner, never opens a competing readline. */
export class CliToolApproval implements ToolApproval {
  private readonly pending = new Set<AbortController>();
  constructor(
    private readonly mode: PermissionMode,
    private readonly prompt?: CliApprovalPrompt,
  ) {}
  async approve(
    call: ToolCall,
    _session: Session,
    context?: { readonly signal?: AbortSignal },
  ): Promise<boolean> {
    context?.signal?.throwIfAborted();
    if (
      this.mode === "auto-all" ||
      (this.mode === "auto-read" && readOnlyTools.has(call.name))
    )
      return true;
    if (!this.prompt)
      throw new Error(
        "Tool approval unavailable in a non-interactive terminal (TTY required). Use an interactive CLI, a client with approvals, or explicitly select --permission auto-all for an authorized task.",
      );
    const controller = new AbortController();
    const abort = () => controller.abort(context?.signal?.reason);
    context?.signal?.addEventListener("abort", abort, { once: true });
    this.pending.add(controller);
    try {
      const detail = JSON.stringify({ tool: call.name, input: call.input });
      const label = `\nApprove tool request?\n${detail.slice(0, 4000)}${detail.length > 4000 ? "\n[preview truncated]" : ""}\nAllow once [y/N]: `;
      return /^(?:y|yes)$/i.test(
        (
          await this.prompt.question(label, {
            signal: controller.signal,
            call,
          })
        ).trim(),
      );
    } finally {
      context?.signal?.removeEventListener("abort", abort);
      this.pending.delete(controller);
    }
  }
  denyAll(): void {
    for (const controller of this.pending)
      controller.abort(new Error("Tool approval cancelled"));
  }
}

/** SIGINT/Stop cancels model work and any outstanding readline approval. */
export async function runCliTurn(
  runtime: AgentRuntime,
  sessionId: string,
  prompt: string,
  readline?: Interface,
): Promise<void> {
  const controller = new AbortController();
  const stop = () =>
    controller.abort(new DOMException("Run stopped", "AbortError"));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  readline?.once("SIGINT", stop);
  try {
    await runtime.run(sessionId, prompt, controller.signal);
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    readline?.removeListener("SIGINT", stop);
  }
}
