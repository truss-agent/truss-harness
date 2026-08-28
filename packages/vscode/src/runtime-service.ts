import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import {
  LOCAL_SERVICE_PROTOCOL_VERSIONS,
  validateRuntimeServiceHandshake,
} from "@truss-harness/cli/protocol";
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
  private readonly ready: Promise<void>;

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
    this.ready = this.initialize();
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

  async waitUntilReady(): Promise<void> {
    await this.ready;
  }

  async createSession(
    messages: readonly ConversationMessage[],
  ): Promise<string> {
    await this.ready;
    const response = await this.request({ type: "create_session", messages })
      .result;
    if (!response.result.sessionId) {
      throw new Error("The Truss service did not create a session.");
    }
    return response.result.sessionId;
  }

  abort(requestId: string): void {
    void this.ready.then(
      () => this.write({ type: "abort", requestId }),
      () => undefined,
    );
  }

  approve(requestId: string, callId: string, approved: boolean): void {
    void this.ready.then(
      () => this.write({ type: "tool_approval", requestId, callId, approved }),
      () => undefined,
    );
  }

  dispose(): void {
    this.reader.close();
    this.failAll(new Error("Truss service stopped."));
    this.process.kill();
  }

  private async initialize(): Promise<void> {
    const response = await this.request(
      {
        type: "initialize",
        protocolVersions: LOCAL_SERVICE_PROTOCOL_VERSIONS,
        client: { name: "truss-vscode" },
      },
      false,
    ).result;
    const handshake = validateRuntimeServiceHandshake(
      response.result,
      LOCAL_SERVICE_PROTOCOL_VERSIONS,
    );
    if (!handshake.compatible)
      throw new Error(
        `${handshake.reason} Update truss-cli or clear trussHarness.command to use the bundled service.`,
      );
  }

  private request(
    payload: Record<string, unknown>,
    waitForReady = true,
  ): RunHandle {
    const requestId = `vscode-${++this.requestSequence}`;
    let resolveRequest: (message: ServiceResponse) => void;
    let rejectRequest: (error: Error) => void;
    const result = new Promise<ServiceResponse>((resolve, reject) => {
      resolveRequest = resolve;
      rejectRequest = reject;
    });
    this.requests.set(requestId, {
      resolve: resolveRequest!,
      reject: rejectRequest!,
    });
    const send = () => this.write({ ...payload, requestId });
    if (waitForReady) {
      void this.ready.then(send, (error: unknown) => {
        this.requests.delete(requestId);
        rejectRequest!(
          error instanceof Error ? error : new Error(String(error)),
        );
      });
    } else send();
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
