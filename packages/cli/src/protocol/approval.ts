import type { Session, ToolApproval, ToolCall } from "@truss-harness/runtime";
import type { PermissionMode } from "../protocol-contracts.js";

const readOnlyTools = new Set([
  "read_file",
  "list_directory",
  "search_files",
  "grep",
]);

interface PendingApproval {
  readonly sessionId: string;
  readonly resolve: (approved: boolean) => void;
}

type ApprovalListener = (call: ToolCall, session: Session) => void;

/** Bridges runtime approval requests to clients using the local service protocol. */
export class ProtocolToolApproval implements ToolApproval {
  private readonly pending = new Map<string, PendingApproval>();
  private readonly listeners = new Set<ApprovalListener>();

  constructor(private readonly mode: PermissionMode = "ask") {}

  approve(call: ToolCall, session: Session): Promise<boolean> {
    if (this.mode === "auto-all") return Promise.resolve(true);
    if (this.mode === "auto-read" && readOnlyTools.has(call.name))
      return Promise.resolve(true);
    const result = new Promise<boolean>((resolve) =>
      this.pending.set(call.id, { sessionId: session.id, resolve }),
    );
    for (const listener of this.listeners) listener(call, session);
    return result;
  }

  subscribe(listener: ApprovalListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  resolve(callId: string, approved: boolean): boolean {
    const pending = this.pending.get(callId);
    if (!pending) return false;
    this.pending.delete(callId);
    pending.resolve(approved);
    return true;
  }

  denySession(sessionId: string): void {
    for (const [callId, pending] of this.pending) {
      if (pending.sessionId !== sessionId) continue;
      this.pending.delete(callId);
      pending.resolve(false);
    }
  }

  denyAll(): void {
    for (const pending of this.pending.values()) pending.resolve(false);
    this.pending.clear();
  }
}
