import type { ChatAttachment, ContextBlock } from "@truss-harness/runtime";
import type {
  RuntimeServiceErrorCode,
  RuntimeServiceMessage,
  RuntimeServiceRuntime,
} from "../protocol-contracts.js";

export class RunRegistry {
  private readonly controllers = new Map<string, AbortController>();
  private readonly requestSessions = new Map<string, string>();
  private readonly activeRequestBySession = new Map<string, string>();
  private readonly activeRequestIds = new Set<string>();
  private readonly activeRuns = new Set<Promise<void>>();

  constructor(
    private readonly options: {
      readonly runtime: RuntimeServiceRuntime;
      readonly send: (message: RuntimeServiceMessage) => void;
      readonly sendError: (
        code: RuntimeServiceErrorCode,
        message: string,
        requestId?: string,
      ) => void;
      readonly denySession: (sessionId: string) => void;
      readonly isClosed: () => boolean;
    },
  ) {}

  requestForSession(sessionId: string): string | undefined {
    return this.activeRequestBySession.get(sessionId);
  }
  start(input: {
    readonly requestId: string;
    readonly prompt: string;
    readonly sessionId?: string;
    readonly context: readonly ContextBlock[];
    readonly attachments: readonly ChatAttachment[];
  }): void {
    if (this.activeRequestIds.has(input.requestId))
      throw new Error("That requestId already has an active run.");
    this.activeRequestIds.add(input.requestId);
    const run = this.run(input);
    this.activeRuns.add(run);
    void run.finally(() => this.activeRuns.delete(run));
  }
  cancel(requestId: string): boolean {
    const controller = this.controllers.get(requestId);
    if (!controller) return false;
    controller.abort();
    const sessionId = this.requestSessions.get(requestId);
    if (sessionId) this.options.denySession(sessionId);
    return true;
  }
  async close(): Promise<void> {
    for (const controller of this.controllers.values()) controller.abort();
    await Promise.race([
      Promise.allSettled([...this.activeRuns]),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
    this.controllers.clear();
    this.requestSessions.clear();
    this.activeRequestBySession.clear();
    this.activeRequestIds.clear();
  }
  private async run(input: {
    readonly requestId: string;
    readonly prompt: string;
    readonly sessionId?: string;
    readonly context: readonly ContextBlock[];
    readonly attachments: readonly ChatAttachment[];
  }): Promise<void> {
    let sessionId: string | undefined;
    try {
      const session = input.sessionId
        ? await this.options.runtime.getSession(input.sessionId)
        : await this.options.runtime.createSession();
      if (this.options.isClosed()) return;
      if (!session) {
        this.options.sendError(
          "unknown_request",
          `Unknown session: ${input.sessionId}`,
          input.requestId,
        );
        return;
      }
      sessionId = session.id;
      if (this.activeRequestBySession.has(sessionId)) {
        this.options.sendError(
          "request_conflict",
          "That session already has an active run.",
          input.requestId,
        );
        return;
      }
      const controller = new AbortController();
      this.controllers.set(input.requestId, controller);
      this.requestSessions.set(input.requestId, sessionId);
      this.activeRequestBySession.set(sessionId, input.requestId);
      this.options.send({
        type: "lifecycle",
        requestId: input.requestId,
        state: "started",
        sessionId,
      });
      await this.options.runtime.run(
        sessionId,
        input.prompt,
        controller.signal,
        input.context,
        input.attachments,
      );
      if (this.options.isClosed()) return;
      this.options.send({
        type: "lifecycle",
        requestId: input.requestId,
        state: controller.signal.aborted ? "cancelled" : "completed",
        sessionId,
      });
      this.options.send({
        type: "response",
        requestId: input.requestId,
        result: {
          sessionId,
          ...(controller.signal.aborted ? { aborted: true } : {}),
        },
      });
    } catch (error) {
      if (this.options.isClosed()) return;
      const aborted = this.controllers.get(input.requestId)?.signal.aborted;
      if (aborted) {
        this.options.send({
          type: "lifecycle",
          requestId: input.requestId,
          state: "cancelled",
          ...(sessionId ? { sessionId } : {}),
        });
        this.options.send({
          type: "response",
          requestId: input.requestId,
          result: { ...(sessionId ? { sessionId } : {}), aborted: true },
        });
      } else {
        this.options.send({
          type: "lifecycle",
          requestId: input.requestId,
          state: "failed",
          ...(sessionId ? { sessionId } : {}),
        });
        this.options.sendError(
          "internal_error",
          error instanceof Error ? error.message : String(error),
          input.requestId,
        );
      }
    } finally {
      this.controllers.delete(input.requestId);
      this.requestSessions.delete(input.requestId);
      this.activeRequestIds.delete(input.requestId);
      if (
        sessionId &&
        this.activeRequestBySession.get(sessionId) === input.requestId
      )
        this.activeRequestBySession.delete(sessionId);
    }
  }
}
