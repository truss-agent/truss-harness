import {
  type ClientConfiguration,
  createClientRuntime,
} from "@truss-harness/cli/runtime";
import {
  cloudProviderDefinition,
  isCloudProviderId,
} from "@truss-harness/provider-openai-compatible";
import type {
  ChatAttachment,
  ContextBlock,
  RemoteToolApprovalMode,
  ToolApproval,
  ToolCall,
} from "@truss-harness/runtime";
import type {
  DesktopConfiguration,
  DesktopEvent,
  DesktopMessage,
  DesktopState,
} from "../shared.js";
import { contextBudgetForConfiguration } from "./desktop-configuration.js";
import type { WorkspaceService } from "./workspace-service.js";

export interface DesktopChatInput {
  readonly prompt: string;
  readonly conversationId: string;
  readonly history: readonly DesktopMessage[];
  readonly attachments?: readonly ChatAttachment[];
  readonly activeFilePath?: string;
  readonly attachedPaths?: readonly string[];
  readonly openFilePaths?: readonly string[];
}

type ClientRuntime = Awaited<ReturnType<typeof createClientRuntime>>;

export class DesktopRuntimeService {
  private client: ClientRuntime | undefined;
  private unsubscribeEvents: (() => void) | undefined;
  private activeSessionId: string | undefined;
  private activeConversationId: string | undefined;
  private activeAbort: AbortController | undefined;
  private activeRun: Promise<void> | undefined;
  private readonly approvalResolvers = new Map<
    string,
    (approved: boolean) => void
  >();
  private sessionAllowsAllTools = false;
  private readonly sessionConversationIds = new Map<string, string>();
  private readonly remoteClients: ClientRuntime[] = [];

  constructor(
    private readonly state: () => DesktopState,
    private readonly setState: (state: DesktopState) => void,
    private readonly credential: (
      reference: string,
    ) => Promise<string | undefined>,
    private readonly workspace: WorkspaceService,
    private readonly send: (event: DesktopEvent) => void,
  ) {}

  get mcpServers(): ClientRuntime["mcpServers"] {
    return this.client?.mcpServers ?? [];
  }

  get running(): boolean {
    return Boolean(this.client);
  }

  async configure(configuration: DesktopConfiguration): Promise<void> {
    await this.dispose();
    this.client = await createClientRuntime(
      await this.clientConfiguration(configuration),
    );
    this.setState({
      ...this.state(),
      mcpStatuses: this.client.mcpServers,
      runtimeError: undefined,
    });
    this.unsubscribeEvents = this.client.events.subscribe((event) =>
      this.send({
        type: "agent",
        conversationId: this.sessionConversationIds.get(event.sessionId),
        event,
      }),
    );
  }

  async dispose(): Promise<void> {
    this.activeAbort?.abort();
    this.activeAbort = undefined;
    this.activeRun = undefined;
    this.activeSessionId = undefined;
    this.activeConversationId = undefined;
    this.sessionAllowsAllTools = false;
    this.sessionConversationIds.clear();
    this.unsubscribeEvents?.();
    this.unsubscribeEvents = undefined;
    const previousClient = this.client;
    this.client = undefined;
    await previousClient?.dispose();
    for (const resolveApproval of this.approvalResolvers.values())
      resolveApproval(false);
    this.approvalResolvers.clear();
  }

  async disposeRemoteClients(): Promise<void> {
    await Promise.all(
      this.remoteClients.splice(0).map((client) => client.dispose()),
    );
  }

  stop(): void {
    this.activeAbort?.abort();
  }

  resolveApproval(
    callId: string,
    approved: boolean,
    allowAllForSession = false,
  ): void {
    if (approved && allowAllForSession) this.sessionAllowsAllTools = true;
    this.approvalResolvers.get(callId)?.(approved);
    this.approvalResolvers.delete(callId);
  }

  async runChat(input: DesktopChatInput): Promise<void> {
    const previousRun = this.activeRun;
    if (previousRun) {
      this.activeAbort?.abort();
      await previousRun.catch(() => undefined);
    }
    const run = this.executeChat(input);
    this.activeRun = run;
    try {
      await run;
    } finally {
      if (this.activeRun === run) this.activeRun = undefined;
    }
  }

  async createRemoteRuntime(
    configuration: DesktopConfiguration,
    mode: DesktopConfiguration["mode"],
    approvalMode: RemoteToolApprovalMode = "ask",
  ): Promise<{
    readonly runtime: ClientRuntime["runtime"];
    readonly events: ClientRuntime["events"];
    readonly approval: ToolApproval & {
      resolve(callId: string, approved: boolean): boolean;
      denyAll(): void;
    };
    readonly dispose: () => Promise<void>;
  }> {
    const approval = remoteApproval(approvalMode);
    const client = await createClientRuntime({
      ...(await this.clientConfiguration(configuration)),
      mode,
      approval,
    });
    this.remoteClients.push(client);
    return {
      runtime: client.runtime,
      events: client.events,
      approval,
      dispose: client.dispose,
    };
  }

  private async clientConfiguration(
    configuration: DesktopConfiguration,
  ): Promise<ClientConfiguration> {
    const approval: ToolApproval = {
      approve: (call: ToolCall): Promise<boolean> => {
        const readOnly = isReadOnlyTool(call.name);
        if (
          this.sessionAllowsAllTools ||
          configuration.permission === "auto-all" ||
          (configuration.permission === "auto-read" && readOnly)
        )
          return Promise.resolve(true);
        return new Promise<boolean>((resolveApproval) => {
          this.approvalResolvers.set(call.id, resolveApproval);
          this.send({
            type: "approval",
            callId: call.id,
            tool: call.name,
            input: call.input,
          });
        });
      },
    };
    return {
      workspaceRoot: this.state().workspaceRoot,
      provider: configuration.provider as ClientConfiguration["provider"],
      baseUrl: configuration.baseUrl,
      model: configuration.model,
      apiKey: await this.credential(
        configuration.credentialAccountId ?? configuration.provider,
      ),
      mode: configuration.mode,
      internetAccess: configuration.internetAccess,
      mcpServers: configuration.mcpServers,
      approval,
    };
  }

  private async fileContext(
    activeFilePath: string | undefined,
    attachedPaths: readonly string[] | undefined,
    openFilePaths: readonly string[] | undefined,
  ): Promise<readonly ContextBlock[]> {
    const attached = new Set(attachedPaths ?? []);
    const openFiles = new Set(openFilePaths ?? []);
    const paths = [
      ...new Set(
        [
          activeFilePath,
          ...(attachedPaths ?? []),
          ...(openFilePaths ?? []),
        ].filter((path): path is string => Boolean(path)),
      ),
    ].slice(0, 8);
    const blocks: ContextBlock[] = [];
    const configuration = this.state().configuration;
    const primaryBudget = Math.max(
      2_000,
      Math.min(
        20_000,
        configuration ? contextBudgetForConfiguration(configuration) : 8_192,
      ),
    );
    let remaining = 80_000;
    for (const path of paths) {
      if (remaining <= 0) break;
      try {
        const isPrimary = path === activeFilePath;
        const isAttached = attached.has(path);
        const source = isPrimary
          ? "active-file"
          : isAttached
            ? "attached-file"
            : "open-file";
        const priority = isPrimary ? 1_000 : isAttached ? 400 : 100;
        const contentType = this.workspace.mediaType(path);
        if (contentType && contentType !== "image/svg+xml") {
          blocks.push({
            source: `${source}:${path}`,
            content: `This ${contentType.startsWith("video/") ? "video" : "image"} file is open in the desktop viewer. Binary content is not included in text model context.`,
            priority,
          });
          continue;
        }
        const content = await this.workspace.readFile(path);
        const clipped = content.slice(
          0,
          Math.min(isPrimary ? primaryBudget : 30_000, remaining),
        );
        blocks.push({
          source: `${source}:${path}`,
          content: isPrimary
            ? `This is the currently open workspace file and the primary context for this request. Tool results produced later in the run take precedence over this request-start snapshot.\n\n${clipped}`
            : !isAttached && openFiles.has(path)
              ? `This workspace file is currently open in another editor tab.\n\n${clipped}`
              : clipped,
          priority,
        });
        remaining -= clipped.length;
      } catch {
        // A stale editor path must not fail an otherwise valid chat request.
      }
    }
    return blocks;
  }

  private async executeChat(input: DesktopChatInput): Promise<void> {
    const configuration = this.state().configuration;
    if (!configuration?.model)
      throw new Error("Choose a local model before starting the agent.");
    if (!this.client) await this.configure(configuration);
    const client = this.client;
    if (!client) throw new Error("The model runtime is not ready.");
    if (
      !this.activeSessionId ||
      this.activeConversationId !== input.conversationId
    ) {
      this.sessionAllowsAllTools = false;
      const session = await client.runtime.createSession(input.history);
      this.activeSessionId = session.id;
      this.activeConversationId = input.conversationId;
      this.sessionConversationIds.set(session.id, input.conversationId);
    }
    const controller = new AbortController();
    this.activeAbort = controller;
    this.send({ type: "chat-start", conversationId: input.conversationId });
    try {
      await client.runtime.run(
        this.activeSessionId,
        input.prompt,
        controller.signal,
        await this.fileContext(
          input.activeFilePath,
          input.attachedPaths,
          input.openFilePaths,
        ),
        input.attachments,
      );
      this.send({
        type: "chat-end",
        conversationId: input.conversationId,
        aborted: controller.signal.aborted,
      });
    } catch (error) {
      this.send(
        controller.signal.aborted
          ? {
              type: "chat-end",
              conversationId: input.conversationId,
              aborted: true,
            }
          : {
              type: "chat-error",
              conversationId: input.conversationId,
              message: error instanceof Error ? error.message : String(error),
            },
      );
    } finally {
      if (this.activeAbort === controller) this.activeAbort = undefined;
    }
  }
}

export function safeRuntimeConfigurationError(
  configuration: DesktopConfiguration,
  error: unknown,
): string {
  const message = error instanceof Error ? error.message : String(error);
  if (
    isCloudProviderId(configuration.provider) &&
    /requires a configured credential/i.test(message)
  )
    return `Enter an API key for ${cloudProviderDefinition(configuration.provider).label}.`;
  return "The configured model runtime could not be started. Review Settings and try again.";
}

function isReadOnlyTool(name: string): boolean {
  return ["read_file", "list_directory", "search_files", "grep"].includes(name);
}

function remoteApproval(mode: RemoteToolApprovalMode = "ask"): ToolApproval & {
  resolve(callId: string, approved: boolean): boolean;
  denyAll(): void;
} {
  const pending = new Map<string, (approved: boolean) => void>();
  return {
    approve(call: ToolCall): Promise<boolean> {
      if (
        mode === "auto-all" ||
        (mode === "auto-read" && isReadOnlyTool(call.name))
      )
        return Promise.resolve(true);
      return new Promise((resolveApproval) =>
        pending.set(call.id, resolveApproval),
      );
    },
    resolve(callId: string, approved: boolean): boolean {
      const resolveApproval = pending.get(callId);
      if (!resolveApproval) return false;
      pending.delete(callId);
      resolveApproval(approved);
      return true;
    },
    denyAll(): void {
      for (const resolveApproval of pending.values()) resolveApproval(false);
      pending.clear();
    },
  };
}
