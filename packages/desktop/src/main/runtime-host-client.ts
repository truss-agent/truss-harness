import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import {
  LOCAL_SERVICE_PROTOCOL_VERSIONS,
  validateRuntimeServiceHandshake,
  type RuntimeServiceMessage,
} from "@truss-harness/cli/protocol";
import type { ChatAttachment, ContextBlock } from "@truss-harness/runtime";

export interface DesktopRuntimeHostClientOptions {
  readonly artifactPath: string;
  readonly cwd: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly onEvent: (event: {
    readonly type: string;
    readonly sessionId: string;
    readonly text?: string;
    readonly tool?: string;
    readonly callId?: string;
    readonly input?: Record<string, unknown>;
    readonly result?: { readonly content?: string; readonly isError?: boolean };
    readonly error?: string;
    readonly modifiedFiles?: readonly string[];
  }) => void;
  readonly onApproval: (request: {
    readonly callId: string;
    readonly tool: string;
    readonly input: Record<string, unknown>;
  }) => void;
  readonly onDiagnostic: (message: string) => void;
}

type Response = Extract<RuntimeServiceMessage, { readonly type: "response" }>;

/** JSONL host client used only after Desktop has verified an active artifact. */
export class DesktopRuntimeHostClient {
  private readonly process: ChildProcessWithoutNullStreams;
  private readonly reader;
  private readonly requests = new Map<
    string,
    { resolve: (response: Response) => void; reject: (error: Error) => void }
  >();
  private sequence = 0;

  constructor(private readonly options: DesktopRuntimeHostClientOptions) {
    this.process = spawn(process.execPath, [options.artifactPath, "serve"], {
      cwd: options.cwd,
      env: { ...options.environment, ELECTRON_RUN_AS_NODE: "1" },
      windowsHide: true,
    });
    this.reader = createInterface({
      input: this.process.stdout,
      crlfDelay: Infinity,
    });
    this.reader.on("line", (line) => this.handleLine(line));
    this.process.stderr.on("data", (data: Buffer) =>
      options.onDiagnostic(data.toString()),
    );
    this.process.on("error", (error) => this.failAll(error));
    this.process.on("exit", (code) =>
      this.failAll(
        new Error(`Truss runtime host exited with code ${code ?? "unknown"}.`),
      ),
    );
  }

  async start(): Promise<void> {
    const response = await this.request({
      type: "initialize",
      protocolVersions: LOCAL_SERVICE_PROTOCOL_VERSIONS,
      client: { name: "truss-desktop" },
    });
    const handshake = validateRuntimeServiceHandshake(
      response.result,
      LOCAL_SERVICE_PROTOCOL_VERSIONS,
    );
    if (!handshake.compatible) throw new Error(handshake.reason);
  }

  async createSession(
    messages: readonly {
      readonly role: "user" | "assistant";
      readonly content: string;
    }[],
  ): Promise<string> {
    const response = await this.request({ type: "create_session", messages });
    if (!response.result.sessionId)
      throw new Error("The runtime host did not create a session.");
    return response.result.sessionId;
  }

  async run(input: {
    readonly sessionId: string;
    readonly prompt: string;
    readonly context: readonly ContextBlock[];
    readonly attachments?: readonly ChatAttachment[];
    readonly signal: AbortSignal;
  }): Promise<void> {
    const requestId = this.nextId();
    const abort = () =>
      this.write({
        type: "cancel",
        requestId: this.nextId(),
        targetRequestId: requestId,
      });
    input.signal.addEventListener("abort", abort, { once: true });
    try {
      await this.request(
        {
          type: "run",
          prompt: input.prompt,
          sessionId: input.sessionId,
          context: input.context,
          attachments: input.attachments,
        },
        requestId,
      );
    } finally {
      input.signal.removeEventListener("abort", abort);
    }
  }

  approve(callId: string, approved: boolean): void {
    this.write({
      type: "tool_approval",
      requestId: this.nextId(),
      callId,
      approved,
    });
  }

  dispose(): void {
    this.reader.close();
    this.failAll(new Error("Truss runtime host stopped."));
    this.process.kill();
  }

  private nextId(): string {
    return `desktop-runtime-${++this.sequence}`;
  }

  private request(
    payload: Record<string, unknown>,
    requestId = this.nextId(),
  ): Promise<Response> {
    return new Promise<Response>((resolve, reject) => {
      this.requests.set(requestId, { resolve, reject });
      this.write({ ...payload, requestId });
    });
  }

  private write(payload: Record<string, unknown>): void {
    this.process.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  private handleLine(line: string): void {
    let message: RuntimeServiceMessage;
    try {
      message = JSON.parse(line) as RuntimeServiceMessage;
    } catch {
      return;
    }
    if (message.type === "event") {
      const event = message.event;
      this.options.onEvent({
        ...event,
        ...(event.type === "run_failed" ? { error: event.error } : {}),
      });
      return;
    }
    if (message.type === "approval_request") {
      this.options.onApproval(message);
      return;
    }
    if (message.type === "lifecycle") return;
    const requestId = message.requestId;
    if (!requestId) return;
    const pending = this.requests.get(requestId);
    if (!pending) return;
    this.requests.delete(requestId);
    if (message.type === "error") pending.reject(new Error(message.message));
    else if (message.type === "response") pending.resolve(message);
  }

  private failAll(error: Error): void {
    for (const pending of this.requests.values()) pending.reject(error);
    this.requests.clear();
  }
}
