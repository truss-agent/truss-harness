import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { ChatAttachment, ContextBlock } from "@truss-harness/runtime";
import type { Disposable } from "vscode";
import type {
  ConversationMessage,
  RunHandle,
  ServiceEvent,
  ServiceMessage,
  ServiceResponse,
} from "./contracts.js";

export class RuntimeService implements Disposable {
  private readonly process: ChildProcessWithoutNullStreams;
  private readonly requests = new Map<
    string,
    { resolve(message: ServiceResponse): void; reject(error: Error): void }
  >();
  private readonly reader;
  private requestSequence = 0;

  constructor(
    command: string,
    commandArguments: readonly string[],
    cwd: string,
    environment: NodeJS.ProcessEnv,
    private readonly onEvent: (event: ServiceEvent) => void,
    onDiagnostic: (text: string) => void,
  ) {
    this.process = spawn(command, [...commandArguments, "serve"], {
      cwd,
      env: environment,
      windowsHide: true,
    });
    this.reader = createInterface({
      input: this.process.stdout,
      crlfDelay: Infinity,
    });
    this.reader.on("line", (line) => this.handleMessage(line));
    this.process.stderr.on("data", (data: Buffer) =>
      onDiagnostic(data.toString()),
    );
    this.process.on("error", (error) => this.failAll(error));
    this.process.on("exit", (code) =>
      this.failAll(
        new Error(`Truss service exited with code ${code ?? "unknown"}.`),
      ),
    );
  }

  run(
    prompt: string,
    sessionId?: string,
    context?: readonly ContextBlock[],
    attachments?: readonly ChatAttachment[],
  ): RunHandle {
    return this.request({
      type: "run",
      prompt,
      sessionId,
      context,
      attachments,
    });
  }

  async createSession(
    messages: readonly ConversationMessage[],
  ): Promise<string> {
    const response = await this.request({ type: "create_session", messages })
      .result;
    if (!response.result.sessionId) {
      throw new Error("The Truss service did not create a session.");
    }
    return response.result.sessionId;
  }

  abort(requestId: string): void {
    this.write({ type: "abort", requestId });
  }

  approve(requestId: string, callId: string, approved: boolean): void {
    this.write({ type: "tool_approval", requestId, callId, approved });
  }

  dispose(): void {
    this.reader.close();
    this.failAll(new Error("Truss service stopped."));
    this.process.kill();
  }

  private request(payload: Record<string, unknown>): RunHandle {
    const requestId = `vscode-${++this.requestSequence}`;
    const result = new Promise<ServiceResponse>((resolve, reject) =>
      this.requests.set(requestId, { resolve, reject }),
    );
    this.write({ ...payload, requestId });
    return { requestId, result };
  }

  private write(payload: Record<string, unknown>): void {
    this.process.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  private handleMessage(line: string): void {
    let message: ServiceMessage;
    try {
      message = JSON.parse(line) as ServiceMessage;
    } catch {
      return;
    }
    if (message.type === "event") {
      this.onEvent(message);
      return;
    }
    if (message.type === "lifecycle") return;
    const request = message.requestId
      ? this.requests.get(message.requestId)
      : undefined;
    if (!request) return;
    this.requests.delete(message.requestId as string);
    if (message.type === "error") request.reject(new Error(message.message));
    else if (message.type === "response") request.resolve(message);
  }

  private failAll(error: Error): void {
    for (const request of this.requests.values()) request.reject(error);
    this.requests.clear();
  }
}
