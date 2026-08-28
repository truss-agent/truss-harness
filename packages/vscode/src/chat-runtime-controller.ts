import {
  type ChatAttachment,
  executeWorkspaceCommand,
} from "@truss-harness/runtime";
import * as vscode from "vscode";
import type {
  ConversationMessage,
  ModelConfiguration,
  RunHandle,
  ServiceEvent,
} from "./contracts.js";
import { ConversationRunRegistry } from "./conversation-runs.js";
import { normalizeHistory } from "./conversation-state.js";
import type { InlineResponseBuffer } from "./inline-responses.js";
import { RuntimeService } from "./runtime-service.js";
import { resolveRuntimeHostLaunch } from "./runtime-host-resolution.js";
import { workspaceFileContext } from "./workspace-context.js";

export interface ChatRuntimeControllerOptions {
  readonly context: vscode.ExtensionContext;
  readonly output: vscode.OutputChannel;
  readonly configuration: () => ModelConfiguration;
  readonly runtimeEnvironment: () => Promise<NodeJS.ProcessEnv>;
  readonly workspaceRoot: () => string;
  readonly responses: InlineResponseBuffer;
}

export class ChatRuntimeController implements vscode.Disposable {
  private readonly runs = new ConversationRunRegistry();
  private readonly cancelledConversationIds = new Set<string>();
  private readonly deletedConversationIds = new Set<string>();
  private readonly liveSessionIds = new Map<string, string>();
  private view: vscode.WebviewView | undefined;
  private serviceValue: RuntimeService | undefined;

  constructor(private readonly options: ChatRuntimeControllerOptions) {}

  attach(view: vscode.WebviewView): void {
    this.view = view;
  }

  detach(view: vscode.WebviewView): void {
    if (this.view === view) this.view = undefined;
  }

  post(message: unknown): void {
    void this.view?.webview
      .postMessage(message)
      .then(undefined, () => undefined);
  }

  stop(conversationId: string): void {
    const requestId = this.runs.requestForConversation(conversationId);
    if (requestId) this.serviceValue?.abort(requestId);
    else this.cancelledConversationIds.add(conversationId);
  }

  delete(conversationId: string): void {
    this.cancelledConversationIds.add(conversationId);
    this.deletedConversationIds.add(conversationId);
    const requestId = this.runs.requestForConversation(conversationId);
    if (requestId) {
      this.serviceValue?.abort(requestId);
      this.runs.finish(requestId);
    }
    this.liveSessionIds.delete(conversationId);
  }

  approve(
    conversationId: string,
    requestId: string,
    callId: string,
    approved: boolean,
  ): void {
    if (this.runs.conversationForRequest(requestId) === conversationId) {
      this.serviceValue?.approve(requestId, callId, approved);
    }
  }

  async sendPrompt(
    prompt: string,
    conversationId: string,
    history: readonly ConversationMessage[],
    attachments?: readonly ChatAttachment[],
    attachedPaths?: readonly string[],
  ): Promise<void> {
    if (!prompt.trim()) return;
    if (this.runs.requestForConversation(conversationId)) {
      this.post({
        type: "error",
        conversationId,
        message: "That conversation already has an active run.",
      });
      return;
    }
    this.cancelledConversationIds.delete(conversationId);
    this.deletedConversationIds.delete(conversationId);
    let run: RunHandle | undefined;
    let aborted = false;
    let handledWorkspaceCommand = false;
    try {
      const command = await executeWorkspaceCommand({
        workspaceRoot: this.options.workspaceRoot(),
        input: prompt,
      });
      if (command.handled) {
        handledWorkspaceCommand = true;
        this.post({ type: "delta", conversationId, text: command.message });
        return;
      }
      const current = await this.service();
      const sessionId =
        this.liveSessionIds.get(conversationId) ??
        (await current.createSession(normalizeHistory(history)));
      this.liveSessionIds.set(conversationId, sessionId);
      if (this.cancelledConversationIds.delete(conversationId)) {
        aborted = true;
        return;
      }
      run = current.run(
        prompt,
        sessionId,
        await workspaceFileContext(attachedPaths),
        attachments,
      );
      try {
        this.runs.start(conversationId, run.requestId);
      } catch (error) {
        current.abort(run.requestId);
        throw error;
      }
      this.post({ type: "assistantStart", conversationId });
      const response = await run.result;
      const resolvedSessionId = response.result.sessionId ?? sessionId;
      if (
        resolvedSessionId &&
        !this.deletedConversationIds.has(conversationId)
      ) {
        this.liveSessionIds.set(conversationId, resolvedSessionId);
      }
      aborted = response.result.aborted === true;
      if (!this.deletedConversationIds.has(conversationId)) {
        this.post({ type: "session", conversationId });
      }
    } catch (error) {
      if (!this.deletedConversationIds.has(conversationId)) {
        this.post({
          type: "error",
          conversationId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      const finished = run ? this.runs.finish(run.requestId) : undefined;
      if (
        !this.deletedConversationIds.has(conversationId) &&
        (handledWorkspaceCommand || finished || !run)
      ) {
        this.post({ type: "assistantEnd", conversationId, aborted });
      }
    }
  }

  async service(): Promise<RuntimeService> {
    if (this.serviceValue) return this.serviceValue;
    const configuration = this.options.configuration();
    if (!configuration.model) {
      throw new Error("Choose a local model before starting the agent.");
    }
    const { context } = this.options;
    const configuredCommand = vscode.workspace
      .getConfiguration("trussHarness")
      .get<string>("command", "")
      .trim();
    const launch = await resolveRuntimeHostLaunch({
      configuredCommand,
      extensionMode:
        context.extensionMode === vscode.ExtensionMode.Development
          ? "development"
          : "production",
      extensionPath: context.extensionPath,
      globalStoragePath: context.globalStorageUri.fsPath,
      onDiagnostic: (message) => this.options.output.appendLine(message),
    });
    const service = new RuntimeService(
      launch.command,
      launch.arguments,
      this.options.workspaceRoot(),
      {
        ...(await this.options.runtimeEnvironment()),
        ...(launch.requiresNodeEnvironment
          ? { ELECTRON_RUN_AS_NODE: "1" }
          : {}),
      },
      (message) => this.handleEvent(message),
      (text) => this.options.output.append(text),
    );
    this.serviceValue = service;
    context.subscriptions.push(service);
    try {
      await service.waitUntilReady();
    } catch (error) {
      if (this.serviceValue === service) this.serviceValue = undefined;
      service.dispose();
      throw error;
    }
    return service;
  }

  disposeService(): void {
    const activeRuns = this.runs.clear();
    this.cancelledConversationIds.clear();
    this.serviceValue?.dispose();
    this.serviceValue = undefined;
    this.liveSessionIds.clear();
    for (const run of activeRuns) {
      if (!this.deletedConversationIds.has(run.conversationId)) {
        this.post({
          type: "assistantEnd",
          conversationId: run.conversationId,
          aborted: true,
        });
      }
    }
  }

  dispose(): void {
    this.disposeService();
  }

  private handleEvent(message: ServiceEvent): void {
    const conversationId = this.runs.conversationForRequest(message.requestId);
    if (conversationId && this.deletedConversationIds.has(conversationId))
      return;
    if (
      conversationId &&
      message.event.type === "plan_updated" &&
      message.event.plan
    ) {
      this.post({
        type: "plan",
        conversationId,
        plan: message.event.plan,
      });
    }
    if (conversationId) {
      if (message.event.type === "text_delta") {
        this.post({
          type: "delta",
          conversationId,
          text: message.event.text ?? "",
        });
      }
      if (message.event.type === "tool_call_requested") {
        const tool = message.event.tool ?? "unknown";
        const isReadOnly = [
          "read_file",
          "list_directory",
          "search_files",
          "grep",
        ].includes(tool);
        const permission = this.options.configuration().permission;
        const requiresApproval =
          permission === "ask" || (permission === "auto-read" && !isReadOnly);
        this.post(
          requiresApproval
            ? {
                type: "approval",
                conversationId,
                requestId: message.requestId,
                callId: message.event.callId,
                tool,
                input: message.event.input ?? {},
              }
            : { type: "tool", conversationId, tool },
        );
      }
    }
    if (message.event.type === "text_delta") {
      this.options.responses.append(
        message.requestId,
        message.event.text ?? "",
      );
    }
  }
}
