import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import type { AgentRuntime, ChatMessage, ContextBlock, RuntimeEvent, ToolApproval, ToolCall, Session } from "@truss-harness/runtime";

export type RuntimeServiceRequest =
  | { readonly type: "run"; readonly requestId: string; readonly prompt: string; readonly sessionId?: string; readonly context?: readonly ContextBlock[] }
  | { readonly type: "create_session"; readonly requestId: string; readonly messages?: readonly ChatMessage[] }
  | { readonly type: "abort"; readonly requestId: string }
  | { readonly type: "tool_approval"; readonly requestId: string; readonly callId: string; readonly approved: boolean };

export type RuntimeServiceMessage =
  | { readonly type: "event"; readonly requestId: string; readonly event: RuntimeEvent }
  | { readonly type: "response"; readonly requestId: string; readonly result: { readonly sessionId?: string; readonly aborted?: boolean } }
  | { readonly type: "error"; readonly requestId?: string; readonly message: string };

export type PermissionMode = "ask" | "auto-read" | "auto-all";
const readOnlyTools = new Set(["read_file", "list_directory", "search_files", "grep"]);

function write(message: RuntimeServiceMessage): void {
  stdout.write(`${JSON.stringify(message)}\n`);
}

/** Bridges runtime approval requests to a client using the JSONL service protocol. */
export class ProtocolToolApproval implements ToolApproval {
  private readonly pending = new Map<string, (approved: boolean) => void>();

  constructor(private readonly mode: PermissionMode = "ask") {}

  approve(call: ToolCall, _session: Session): Promise<boolean> {
    if (this.mode === "auto-all") return Promise.resolve(true);
    if (this.mode === "auto-read" && readOnlyTools.has(call.name)) return Promise.resolve(true);
    return new Promise((resolve) => this.pending.set(call.id, resolve));
  }

  resolve(callId: string, approved: boolean): boolean {
    const pending = this.pending.get(callId);
    if (!pending) return false;
    this.pending.delete(callId);
    pending(approved);
    return true;
  }

  denyAll(): void {
    for (const resolve of this.pending.values()) resolve(false);
    this.pending.clear();
  }
}

/** Starts a newline-delimited JSON service suitable for editor clients and process isolation. */
export async function runService(runtime: AgentRuntime, events: { subscribe(listener: (event: RuntimeEvent) => void): () => void }, approval?: ProtocolToolApproval): Promise<void> {
  const requestsBySession = new Map<string, string>();
  const controllers = new Map<string, AbortController>();
  events.subscribe((event) => {
    const requestId = requestsBySession.get(event.sessionId);
    if (requestId) write({ type: "event", requestId, event });
  });

  const lines = createInterface({ input: stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    let request: RuntimeServiceRequest;
    try {
      request = JSON.parse(line) as RuntimeServiceRequest;
    } catch {
      write({ type: "error", message: "Invalid JSON request." });
      continue;
    }

    if (request.type === "abort") {
      const controller = controllers.get(request.requestId);
      if (!controller) write({ type: "error", requestId: request.requestId, message: "Unknown active request." });
      else {
        controller.abort();
        approval?.denyAll();
        write({ type: "response", requestId: request.requestId, result: { aborted: true } });
      }
      continue;
    }

    if (request.type === "tool_approval") {
      approval?.resolve(request.callId, request.approved);
      continue;
    }

    if (request.type === "create_session") {
      const session = await runtime.createSession(request.messages ?? []);
      write({ type: "response", requestId: request.requestId, result: { sessionId: session.id } });
      continue;
    }

    if (request.type !== "run" || typeof request.requestId !== "string" || typeof request.prompt !== "string") {
      write({ type: "error", requestId: (request as { requestId?: string }).requestId, message: "Invalid service request." });
      continue;
    }

    const session = request.sessionId ? await runtime.getSession(request.sessionId) : await runtime.createSession();
    if (!session) {
      write({ type: "error", requestId: request.requestId, message: `Unknown session: ${request.sessionId}` });
      continue;
    }

    const controller = new AbortController();
    requestsBySession.set(session.id, request.requestId);
    controllers.set(request.requestId, controller);
    const requestContext = Array.isArray(request.context)
      ? request.context.filter((block): block is ContextBlock =>
        Boolean(block)
        && typeof block === "object"
        && typeof block.source === "string"
        && typeof block.content === "string"
        && (block.priority === undefined || typeof block.priority === "number"))
      : [];
    void runtime.run(session.id, request.prompt, controller.signal, requestContext)
      .then(() => write({ type: "response", requestId: request.requestId, result: { sessionId: session.id } }))
      .catch((error: unknown) => write({ type: "error", requestId: request.requestId, message: error instanceof Error ? error.message : String(error) }))
      .finally(() => {
        requestsBySession.delete(session.id);
        controllers.delete(request.requestId);
      });
  }
}
