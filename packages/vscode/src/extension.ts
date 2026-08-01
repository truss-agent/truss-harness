import { execFile as execFileCallback, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { createInterface } from "node:readline";
import { cloudProviderDefinition, cloudProviderDefinitions, detectActiveLocalModel, detectLocalContextWindow, detectLocalEndpoints, isCloudProviderId, isLocalEndpointKind, listLocalModels, normalizeLocalBaseUrl, type ModelProviderKind, type LocalModelEndpoint } from "@truss-harness/provider-openai-compatible";
import { brand } from "@truss-harness/branding";
import { FileAgentProfileStore, FileAgentRunHistoryStore, profileFromConfiguration } from "@truss-harness/cli/agents";
import type { ClientConfiguration } from "@truss-harness/cli/runtime";
import { AgentHost } from "@truss-harness/agent-host";
import { McpServerManager, type McpServerConfigurations, type McpServerStatus, type McpStdioServerConfiguration } from "@truss-harness/mcp";
import { AgentCoordinator, ApiKeyCredential, defaultProviderAccountId, executeWorkspaceCommand, isProviderAccount, ToolRegistry, type AgentProfile, type AgentRunSummary, type ChatAttachment, type ContextBlock, type ProviderAccount, type ToolApproval, type ToolCall, type WorkspacePlan } from "@truss-harness/runtime";
import { createPairingUri, detectLanAddress } from "@truss-harness/gateway";
import QRCode from "qrcode";
import * as vscode from "vscode";

const execFile = promisify(execFileCallback);

type AgentMode = "chat" | "plan" | "edit";
type PermissionMode = "ask" | "auto-read" | "auto-all";
interface ModelConfiguration {
  readonly provider: ModelProviderKind;
  readonly baseUrl: string;
  readonly model: string;
  readonly credentialAccountId?: string;
  readonly mode: AgentMode;
  readonly permission: PermissionMode;
  readonly contextWindow: number;
  readonly internetAccess: boolean;
  readonly mcpServers: McpServerConfigurations;
}

interface ServiceEvent {
  readonly type: "event";
  readonly requestId: string;
  readonly event: { readonly type: string; readonly sessionId: string; readonly text?: string; readonly tool?: string; readonly callId?: string; readonly input?: Record<string, unknown>; readonly plan?: WorkspacePlan };
}

interface ServiceResponse {
  readonly type: "response";
  readonly requestId: string;
  readonly result: { readonly sessionId?: string; readonly aborted?: boolean };
}

interface ServiceError {
  readonly type: "error";
  readonly requestId?: string;
  readonly message: string;
}

type ServiceMessage = ServiceEvent | ServiceResponse | ServiceError;

interface RunHandle {
  readonly requestId: string;
  readonly result: Promise<ServiceResponse>;
}

interface ConversationMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly attachments?: readonly ChatAttachment[];
}

interface StoredConversation {
  readonly id: string;
  readonly title: string;
  readonly messages: readonly ConversationMessage[];
  readonly updatedAt: string;
}

interface StoredConversationState {
  readonly conversations: readonly StoredConversation[];
  readonly activeId?: string;
}

interface GitRepository {
  readonly rootUri: vscode.Uri;
  readonly inputBox: { value: string };
}

interface GitApi {
  readonly repositories: readonly GitRepository[];
}

interface GitExtension {
  getAPI(version: 1): GitApi;
}

class RuntimeService implements vscode.Disposable {
  private readonly process: ChildProcessWithoutNullStreams;
  private readonly requests = new Map<string, { resolve(message: ServiceResponse): void; reject(error: Error): void }>();
  private readonly reader;
  private requestSequence = 0;

  constructor(command: string, commandArguments: readonly string[], cwd: string, environment: NodeJS.ProcessEnv, private readonly onEvent: (event: ServiceEvent) => void, onDiagnostic: (text: string) => void) {
    this.process = spawn(command, [...commandArguments, "serve"], { cwd, env: environment, windowsHide: true });
    this.reader = createInterface({ input: this.process.stdout, crlfDelay: Infinity });
    this.reader.on("line", (line) => this.handleMessage(line));
    this.process.stderr.on("data", (data: Buffer) => onDiagnostic(data.toString()));
    this.process.on("error", (error) => this.failAll(error));
    this.process.on("exit", (code) => this.failAll(new Error(`Truss service exited with code ${code ?? "unknown"}.`)));
  }

  run(prompt: string, sessionId?: string, context?: readonly ContextBlock[], attachments?: readonly ChatAttachment[]): RunHandle {
    const requestId = `vscode-${++this.requestSequence}`;
    const result = new Promise<ServiceResponse>((resolve, reject) => this.requests.set(requestId, { resolve, reject }));
    this.process.stdin.write(`${JSON.stringify({ type: "run", requestId, prompt, sessionId, context, attachments })}\n`);
    return { requestId, result };
  }

  async createSession(messages: readonly ConversationMessage[]): Promise<string> {
    const requestId = `vscode-${++this.requestSequence}`;
    const result = new Promise<ServiceResponse>((resolve, reject) => this.requests.set(requestId, { resolve, reject }));
    this.process.stdin.write(`${JSON.stringify({ type: "create_session", requestId, messages })}\n`);
    const response = await result;
    if (!response.result.sessionId) throw new Error("The Truss service did not create a session.");
    return response.result.sessionId;
  }

  abort(requestId: string): void {
    this.process.stdin.write(`${JSON.stringify({ type: "abort", requestId })}\n`);
  }

  approve(requestId: string, callId: string, approved: boolean): void {
    this.process.stdin.write(`${JSON.stringify({ type: "tool_approval", requestId, callId, approved })}\n`);
  }

  dispose(): void {
    this.reader.close();
    this.failAll(new Error("Truss service stopped."));
    this.process.kill();
  }

  private handleMessage(line: string): void {
    let message: ServiceMessage;
    try { message = JSON.parse(line) as ServiceMessage; } catch { return; }
    if (message.type === "event") {
      this.onEvent(message);
      return;
    }
    const request = message.requestId ? this.requests.get(message.requestId) : undefined;
    if (!request) return;
    this.requests.delete(message.requestId as string);
    if (message.type === "error") request.reject(new Error(message.message));
    else request.resolve(message);
  }

  private failAll(error: Error): void {
    for (const request of this.requests.values()) request.reject(error);
    this.requests.clear();
  }
}

type WebviewRequest =
  | { readonly type: "ready" }
  | { readonly type: "discover"; readonly configuration?: ModelConfiguration }
  | { readonly type: "configure"; readonly configuration: ModelConfiguration }
  | { readonly type: "send"; readonly prompt: string; readonly conversationId: string; readonly history: readonly ConversationMessage[]; readonly attachments?: readonly ChatAttachment[]; readonly attachedPaths?: readonly string[] }
  | { readonly type: "stop" }
  | { readonly type: "newConversation" }
  | { readonly type: "selectConversation"; readonly conversationId: string }
  | { readonly type: "deleteConversation"; readonly conversationId: string }
  | { readonly type: "saveConversations"; readonly state: StoredConversationState }
  | { readonly type: "toolApproval"; readonly callId: string; readonly approved: boolean }
  | { readonly type: "connectTrussGo" }
  | { readonly type: "manageMcp" };

type AgentDashboardRequest =
  | { readonly type: "ready" }
  | { readonly type: "start"; readonly agentId: string; readonly prompt: string }
  | { readonly type: "stop"; readonly runId: string }
  | { readonly type: "resolveApproval"; readonly runId: string; readonly callId: string; readonly approved: boolean }
  | { readonly type: "manageProfiles" };

interface AgentDashboardProfile {
  readonly id: string;
  readonly displayName: string;
  readonly provider: string;
  readonly model: string;
  readonly mode: AgentMode;
  readonly approvalPolicy: PermissionMode;
}

interface AgentDashboardRun {
  readonly id: string;
  readonly agentId: string;
  readonly state: AgentRunSummary["state"];
  readonly latestProgress?: string;
  readonly output?: string;
  readonly activeTool?: { readonly callId: string; readonly name: string };
  readonly changedFiles: readonly string[];
  readonly error?: string;
}

interface HostState {
  readonly configuration: ModelConfiguration;
  readonly endpoints: readonly LocalModelEndpoint[];
  readonly models: readonly string[];
  readonly providerAccounts: readonly ProviderAccount[];
}

const defaultConfiguration: ModelConfiguration = {
  provider: "ollama",
  baseUrl: "http://127.0.0.1:11434",
  model: "",
  mode: "chat",
  permission: "ask",
  contextWindow: 8_192,
  internetAccess: false,
  mcpServers: {}
};

const maxStoredConversations = 12;
const maxStoredMessages = 60;
const maxStoredMessageCharacters = 4_000;

async function releaseOllamaModel(configuration: ModelConfiguration): Promise<void> {
  if (configuration.provider !== "ollama" || !configuration.model) return;
  try {
    await fetch(`${configuration.baseUrl.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: configuration.model, keep_alive: 0 }),
      signal: AbortSignal.timeout(2_000)
    });
  } catch {
    // Releasing an idle local model is best-effort and must not block configuration changes.
  }
}

function normalizeConversationState(value: unknown): StoredConversationState {
  if (!value || typeof value !== "object") return { conversations: [] };
  const source = value as Partial<StoredConversationState>;
  const conversations = Array.isArray(source.conversations) ? source.conversations.flatMap((conversation): StoredConversation[] => {
    if (!conversation || typeof conversation !== "object") return [];
    const candidate = conversation as Partial<StoredConversation>;
    if (typeof candidate.id !== "string" || typeof candidate.title !== "string" || !Array.isArray(candidate.messages)) return [];
    const messages = candidate.messages.flatMap((message): ConversationMessage[] => {
      if (!message || typeof message !== "object") return [];
      const item = message as Partial<ConversationMessage>;
      if ((item.role !== "user" && item.role !== "assistant") || typeof item.content !== "string") return [];
      const attachments = Array.isArray(item.attachments) ? item.attachments.filter((attachment): attachment is ChatAttachment => Boolean(attachment)
        && typeof attachment === "object"
        && (attachment.kind === "image" || attachment.kind === "file")
        && typeof attachment.id === "string"
        && typeof attachment.name === "string"
        && typeof attachment.mediaType === "string"
        && typeof attachment.size === "number"
        && (attachment.data === undefined || typeof attachment.data === "string")
        && (attachment.text === undefined || typeof attachment.text === "string")) : [];
      return [{ role: item.role, content: item.content.slice(-maxStoredMessageCharacters), ...(attachments.length ? { attachments } : {}) }];
    }).slice(-maxStoredMessages);
    return [{ id: candidate.id, title: candidate.title.slice(0, 80), messages, updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : new Date().toISOString() }];
  }).slice(0, maxStoredConversations) : [];
  const activeId = typeof source.activeId === "string" && conversations.some((conversation) => conversation.id === source.activeId) ? source.activeId : conversations[0]?.id;
  return { conversations, activeId };
}

function normalizeHistory(value: readonly ConversationMessage[]): readonly ConversationMessage[] {
  return normalizeConversationState({ conversations: [{ id: "history", title: "history", messages: value, updatedAt: new Date().toISOString() }] }).conversations[0]?.messages ?? [];
}

function workspaceRoot(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? vscode.workspace.workspaceFile?.fsPath ?? process.cwd();
}

async function activeWorkspacePlan(): Promise<WorkspacePlan | undefined> {
  try {
    return JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.file(resolve(workspaceRoot(), brand.workspaceDirectory, "plans", "active.json"))))) as WorkspacePlan;
  } catch {
    return undefined;
  }
}

async function workspaceFiles(): Promise<readonly string[]> {
  const root = workspaceRoot();
  const files = await vscode.workspace.findFiles("**/*", "**/{.git,node_modules,dist,coverage,.next}/**", 800);
  return files
    .map((file) => relative(root, file.fsPath).replaceAll("\\", "/"))
    .filter((file) => file && !file.startsWith(".."))
    .sort((left, right) => left.localeCompare(right));
}

function activeEditorWorkspaceFile(): { readonly path: string; readonly content: string } | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== "file") return undefined;
  const root = resolve(workspaceRoot());
  const target = resolve(editor.document.uri.fsPath);
  if (target === root || !target.startsWith(`${root}${sep}`)) return undefined;
  return { path: relative(root, target).replaceAll("\\", "/"), content: editor.document.getText() };
}

async function workspaceFileContext(attachedPaths: readonly string[] | undefined): Promise<readonly ContextBlock[]> {
  const root = resolve(workspaceRoot());
  const activeFile = activeEditorWorkspaceFile();
  const paths = [...new Set([activeFile?.path, ...(attachedPaths ?? [])].filter((path): path is string => Boolean(path)))].slice(0, 8);
  const blocks: ContextBlock[] = [];
  let remaining = 80_000;
  for (const path of paths) {
    if (remaining <= 0) break;
    const target = resolve(root, path);
    if (target !== root && !target.startsWith(`${root}${sep}`)) continue;
    try {
      const isPrimary = path === activeFile?.path;
      const content = isPrimary ? activeFile.content : new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.file(target)));
      const clipped = content.slice(0, Math.min(isPrimary ? 12_000 : 30_000, remaining));
      blocks.push({
        source: `${isPrimary ? "active-file" : "attached-file"}:${path}`,
        content: isPrimary
          ? `This is the currently open workspace file and the primary context for this request. Tool results produced later in the run take precedence over this request-start snapshot.\n\n${clipped}`
          : clipped,
        priority: isPrimary ? 1_000 : 100
      });
      remaining -= clipped.length;
    } catch {
      // A selected file can disappear or become unavailable before the request is sent.
    }
  }
  return blocks;
}

function localEndpoint(configuration: ModelConfiguration & { readonly provider: "ollama" | "openai-compatible" }): LocalModelEndpoint {
  return { id: "configured", label: "Configured endpoint", kind: configuration.provider, baseUrl: configuration.baseUrl };
}

function isLocalConfiguration(configuration: ModelConfiguration): configuration is ModelConfiguration & { readonly provider: "ollama" | "openai-compatible" } {
  return isLocalEndpointKind(configuration.provider);
}

function isConfiguration(value: unknown): value is Omit<ModelConfiguration, "mode" | "permission" | "contextWindow" | "internetAccess" | "mcpServers"> & Partial<Pick<ModelConfiguration, "mode" | "permission" | "contextWindow" | "internetAccess" | "mcpServers">> {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ModelConfiguration>;
  return (isLocalEndpointKind(candidate.provider) || isCloudProviderId(candidate.provider))
    && typeof candidate.baseUrl === "string"
    && typeof candidate.model === "string";
}

function normalizeConfiguration(value: unknown): ModelConfiguration {
  if (!isConfiguration(value)) return defaultConfiguration;
  return {
    provider: value.provider,
    baseUrl: isLocalEndpointKind(value.provider) ? normalizeLocalBaseUrl(value.provider, value.baseUrl) : cloudProviderDefinition(value.provider).baseUrl,
    model: value.model,
    ...(typeof value.credentialAccountId === "string" && value.credentialAccountId.trim()
      ? { credentialAccountId: value.credentialAccountId.trim() }
      : {}),
    mode: value.mode === "plan" || value.mode === "edit" ? value.mode : "chat",
    permission: value.permission === "auto-read" || value.permission === "auto-all" ? value.permission : "ask",
    contextWindow: typeof value.contextWindow === "number" && Number.isFinite(value.contextWindow)
      ? Math.max(512, Math.min(1_000_000, Math.floor(value.contextWindow)))
      : defaultConfiguration.contextWindow,
    internetAccess: value.internetAccess === true,
    mcpServers: normalizeMcpServers(value.mcpServers)
  };
}

function normalizeMcpServers(value: unknown): McpServerConfigurations {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([name, item]) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const source = item as Record<string, unknown>;
    if (typeof source.command !== "string" || !source.command.trim()) return [];
    const args = Array.isArray(source.args) && source.args.every((argument) => typeof argument === "string")
      ? source.args as string[]
      : undefined;
    const env = source.env && typeof source.env === "object" && !Array.isArray(source.env)
      && Object.values(source.env).every((entry) => typeof entry === "string")
      ? source.env as Record<string, string>
      : undefined;
    return [[name, {
      command: source.command,
      args,
      cwd: typeof source.cwd === "string" ? source.cwd : undefined,
      env,
      enabled: source.enabled !== false,
      readOnly: source.readOnly === true
    }]];
  }));
}

function normalizeCommitMessage(value: string): string {
  return value.trim()
    .replace(/^```(?:gitcommit|text|markdown)?\s*/i, "")
    .replace(/\s*```$/, "")
    .replace(/^(?:commit message|message):\s*/i, "")
    .trim();
}

function dashboardProfile(profile: AgentProfile): AgentDashboardProfile {
  return {
    id: profile.id,
    displayName: profile.displayName,
    provider: profile.provider.providerId,
    model: profile.provider.modelId,
    mode: profile.mode,
    approvalPolicy: profile.approvalPolicy,
  };
}

function dashboardRun(run: AgentRunSummary): AgentDashboardRun {
  return {
    id: run.id,
    agentId: run.agentId,
    state: run.state,
    ...(run.latestProgress ? { latestProgress: run.latestProgress } : {}),
    ...(run.output ? { output: run.output } : {}),
    ...(run.activeTool ? { activeTool: run.activeTool } : {}),
    changedFiles: run.changedFiles,
    ...(run.error ? { error: run.error.message } : {}),
  };
}

function dashboardApproval(profile: AgentProfile): ToolApproval & { resolve(callId: string, approved: boolean): boolean; denyAll(): void } {
  const pending = new Map<string, (approved: boolean) => void>();
  return {
    async approve(call: ToolCall): Promise<boolean> {
      const readOnly = ["read_file", "list_directory", "search_files", "grep"].includes(call.name);
      if (profile.approvalPolicy === "auto-all" || (profile.approvalPolicy === "auto-read" && readOnly)) return true;
      return new Promise<boolean>((resolveApproval) => pending.set(call.id, resolveApproval));
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

function normalizeProviderAccounts(value: unknown): ProviderAccount[] {
  return Array.isArray(value) ? value.filter(isProviderAccount) : [];
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel(brand.productName);
  let view: vscode.WebviewView | undefined;
  let service: RuntimeService | undefined;
  let sessionId: string | undefined;
  let activeChatRequest: string | undefined;
  let activeChatConversationId: string | undefined;
  const liveSessionIds = new Map<string, string>();
  const inlineBuffers = new Map<string, string>();
  let configuration = normalizeConfiguration(context.workspaceState.get("modelConfiguration"));
  let conversations = normalizeConversationState(context.workspaceState.get("conversations"));
  let trussGoProcess: ChildProcessWithoutNullStreams | undefined;
  let agentCoordinator: AgentCoordinator | undefined;
  let disposeAgentEvents: (() => void) | undefined;
  let agentPanel: vscode.WebviewPanel | undefined;
  let agentCoordinatorSignature: string | undefined;
  let providerAccounts = normalizeProviderAccounts(
    context.workspaceState.get("providerAccounts"),
  );

  const legacyCredentialKey = (provider: ModelProviderKind): string =>
    `model-provider-api-key:${provider}`;
  const credentialKey = (accountId: string): string =>
    `model-provider-api-key:${accountId}`;
  const providerAccountsFor = (provider: ModelProviderKind): readonly ProviderAccount[] =>
    providerAccounts.filter((account) => account.providerId === provider);
  const persistProviderAccounts = async (): Promise<void> => {
    await context.workspaceState.update("providerAccounts", providerAccounts);
  };
  const ensureProviderAccount = async (
    provider: ModelProviderKind,
    requestedId?: string,
  ): Promise<ProviderAccount | undefined> => {
    if (!isCloudProviderId(provider)) return undefined;
    const requested = requestedId?.trim();
    const existing = requested
      ? providerAccounts.find(
          (account) => account.id === requested && account.providerId === provider,
        )
      : undefined;
    const account = existing ?? (requested ? undefined : providerAccountsFor(provider)[0]);
    if (account) return account;
    const timestamp = new Date().toISOString();
    const created: ProviderAccount = {
      id: defaultProviderAccountId(provider),
      providerId: provider,
      label: cloudProviderDefinition(provider).label,
      authMethod: "api-key",
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    providerAccounts = [...providerAccounts, created];
    await persistProviderAccounts();
    const legacy = await context.secrets.get(legacyCredentialKey(provider));
    if (legacy && !(await context.secrets.get(credentialKey(created.id)))) {
      await context.secrets.store(credentialKey(created.id), legacy);
      await context.secrets.delete(legacyCredentialKey(provider));
    }
    return created;
  };
  const providerApiKeyForReference = async (
    provider: ModelProviderKind,
    reference?: string,
  ): Promise<string | undefined> => {
    if (!isCloudProviderId(provider)) return undefined;
    const account = await ensureProviderAccount(provider, reference);
    if (account) return context.secrets.get(credentialKey(account.id));
    return context.secrets.get(legacyCredentialKey(provider));
  };
  const providerApiKey = async (
    provider = configuration.provider,
  ): Promise<string | undefined> =>
    providerApiKeyForReference(provider, configuration.credentialAccountId);
  const testProviderConnection = async (): Promise<void> => {
    if (!configuration.model.trim()) {
      throw new Error("Choose a provider model before testing the connection.");
    }
    const apiKey = isCloudProviderId(configuration.provider)
      ? await providerApiKey()
      : undefined;
    const host = new AgentHost({
      workspaceRoot: workspaceRoot(),
      credentialResolver: {
        async resolve() {
          return apiKey
            ? new ApiKeyCredential("vscode-connection-test", apiKey)
            : undefined;
        },
      },
    });
    const result = await host.testProviderConnection({
      providerId: configuration.provider,
      endpointUrl: configuration.baseUrl,
      modelId: configuration.model,
      ...(apiKey ? { credentialRef: "configuration" } : {}),
    });
    const message = `${brand.productName}: ${result.message}`;
    if (result.status === "connected") {
      void vscode.window.showInformationMessage(message);
    } else {
      void vscode.window.showWarningMessage(message);
    }
  };
  const persistMcpServers = async (
    mcpServers: McpServerConfigurations,
  ): Promise<void> => {
    configuration = { ...configuration, mcpServers };
    await context.workspaceState.update("modelConfiguration", configuration);
    disposeService();
    await disposeAgentCoordinator();
    post({ type: "runtimeReset" });
    await sendState();
  };
  const editMcpServer = async (
    existingName?: string,
  ): Promise<
    | {
        readonly name: string;
        readonly configuration: McpStdioServerConfiguration;
      }
    | undefined
  > => {
    const existing = existingName
      ? configuration.mcpServers[existingName]
      : undefined;
    const name = await vscode.window.showInputBox({
      prompt: "MCP server name",
      value: existingName ?? "",
      validateInput(value) {
        const normalized = value.trim();
        if (!normalized) return "A server name is required.";
        if (!/^[A-Za-z0-9_-]+$/.test(normalized))
          return "Use letters, numbers, dashes, or underscores.";
        if (
          normalized !== existingName &&
          configuration.mcpServers[normalized]
        )
          return "A server with this name already exists.";
        return undefined;
      },
    });
    if (!name?.trim()) return undefined;
    const command = await vscode.window.showInputBox({
      prompt: "Executable used to start this MCP server",
      value: existing?.command ?? "",
      validateInput: (value) =>
        value.trim() ? undefined : "A command is required.",
    });
    if (!command?.trim()) return undefined;
    const args = await vscode.window.showInputBox({
      prompt: "Arguments, one per line",
      value: (existing?.args ?? []).join("\n"),
    });
    if (args === undefined) return undefined;
    const cwd = await vscode.window.showInputBox({
      prompt: "Working directory relative to this workspace (optional)",
      value: existing?.cwd ?? "",
    });
    if (cwd === undefined) return undefined;
    const trust = await vscode.window.showQuickPick(
      [
        {
          label: "Approval-controlled tools",
          description: "Treat tools as potentially mutating.",
          readOnly: false,
        },
        {
          label: "Read-only tools",
          description: "Expose this server in Plan mode.",
          readOnly: true,
        },
      ],
      {
        placeHolder: "How should Truss classify this server's tools?",
      },
    );
    if (!trust) return undefined;
    return {
      name: name.trim(),
      configuration: {
        command: command.trim(),
        args: args
          .split(/\r?\n/)
          .map((value) => value.trim())
          .filter(Boolean),
        cwd: cwd.trim() || undefined,
        env: existing?.env,
        enabled: existing?.enabled !== false,
        readOnly: trust.readOnly,
      },
    };
  };
  const testMcpServer = async (
    name: string,
    server: McpStdioServerConfiguration,
  ): Promise<McpServerStatus> => {
    const manager = new McpServerManager(
      new ToolRegistry(),
      { [name]: { ...server, enabled: true } },
      { workspaceRoot: workspaceRoot() },
    );
    try {
      return (
        (await manager.connect(name)) ?? {
          name,
          state: "failed",
          toolCount: 0,
          error: "The MCP server is no longer configured.",
        }
      );
    } finally {
      await manager.close();
    }
  };
  const manageMcpServers = async (): Promise<void> => {
    for (;;) {
      const servers = Object.entries(configuration.mcpServers);
      const selected = await vscode.window.showQuickPick(
        [
          {
            label: "$(add) Add MCP server",
            description: "Configure a local stdio server.",
            name: undefined,
          },
          ...servers.map(([name, server]) => ({
            label: `${server.enabled === false ? "$(circle-slash)" : "$(plug)"} ${name}`,
            description:
              server.enabled === false
                ? "disabled"
                : server.readOnly
                  ? "enabled · read-only"
                  : "enabled · approval-controlled",
            detail: server.command,
            name,
          })),
        ],
        {
          placeHolder:
            "Manage MCP servers. Commands and environment values stay on this host.",
        },
      );
      if (!selected) return;
      if (!selected.name) {
        const created = await editMcpServer();
        if (!created) continue;
        await persistMcpServers({
          ...configuration.mcpServers,
          [created.name]: created.configuration,
        });
        continue;
      }
      const name = selected.name;
      const server = configuration.mcpServers[name];
      if (!server) continue;
      const action = await vscode.window.showQuickPick(
        [
          { label: "$(debug-start) Test and inspect tools", action: "test" },
          {
            label:
              server.enabled === false
                ? "$(check) Enable"
                : "$(circle-slash) Disable",
            action: "toggle",
          },
          { label: "$(edit) Edit", action: "edit" },
          { label: "$(trash) Remove", action: "remove" },
        ],
        { placeHolder: `MCP server: ${name}` },
      );
      if (!action) continue;
      if (action.action === "test") {
        const status = await testMcpServer(name, server);
        if (status.state !== "connected") {
          void vscode.window.showWarningMessage(
            `${name}: ${status.error ?? "The MCP server could not connect."}`,
          );
          continue;
        }
        const tools = status.tools ?? [];
        await vscode.window.showQuickPick(
          tools.length
            ? tools.map((tool) => ({
                label: tool.name,
                description: tool.readOnly
                  ? "read-only"
                  : "approval-controlled",
                detail: tool.description,
              }))
            : [
                {
                  label: "No tools discovered.",
                  description: "",
                  detail: undefined,
                },
              ],
          {
            placeHolder: `${name} connected with ${status.toolCount} tool${status.toolCount === 1 ? "" : "s"}`,
          },
        );
        continue;
      }
      if (action.action === "toggle") {
        await persistMcpServers({
          ...configuration.mcpServers,
          [name]: { ...server, enabled: server.enabled === false },
        });
        continue;
      }
      if (action.action === "edit") {
        const edited = await editMcpServer(name);
        if (!edited) continue;
        const { [name]: _old, ...remaining } = configuration.mcpServers;
        await persistMcpServers({
          ...remaining,
          [edited.name]: edited.configuration,
        });
        continue;
      }
      const confirmed = await vscode.window.showWarningMessage(
        `Remove MCP server '${name}'?`,
        { modal: true },
        "Remove",
      );
      if (confirmed === "Remove") {
        const { [name]: _removed, ...remaining } =
          configuration.mcpServers;
        await persistMcpServers(remaining);
      }
    }
  };
  const runtimeEnvironment = async (): Promise<NodeJS.ProcessEnv> => {
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      TRUSS_HARNESS_PROVIDER: configuration.provider,
      TRUSS_HARNESS_BASE_URL: configuration.baseUrl,
      TRUSS_HARNESS_MODEL: configuration.model,
      TRUSS_HARNESS_AGENT_MODE: configuration.mode,
      TRUSS_HARNESS_PERMISSION_MODE: configuration.permission,
      TRUSS_HARNESS_INTERNET_ACCESS: configuration.internetAccess ? "true" : "false",
      TRUSS_HARNESS_MCP_SERVERS: JSON.stringify(configuration.mcpServers)
    };
    if (isCloudProviderId(configuration.provider)) {
      const apiKey = await providerApiKey();
      if (!apiKey) throw new Error(`No API key is stored for ${cloudProviderDefinition(configuration.provider).label}. Run 'Truss: Configure BYOK Provider'.`);
      environment.TRUSS_HARNESS_API_KEY = apiKey;
    }
    return environment;
  };

  const disposeAgentCoordinator = async (): Promise<void> => {
    disposeAgentEvents?.();
    disposeAgentEvents = undefined;
    const current = agentCoordinator;
    agentCoordinator = undefined;
    agentCoordinatorSignature = undefined;
    await current?.dispose();
  };
  const sendAgentSnapshot = async (): Promise<void> => {
    if (!agentPanel || !agentCoordinator) return;
    const profiles = await agentCoordinator.listProfiles();
    void agentPanel.webview.postMessage({
      type: "state",
      profiles: profiles.map(dashboardProfile),
      runs: agentCoordinator.listRuns().map(dashboardRun),
    });
  };
  const ensureAgentCoordinator = async (): Promise<AgentCoordinator> => {
    if (!configuration.model) throw new Error("Choose a model before starting a managed agent.");
    const credential = isCloudProviderId(configuration.provider) ? await providerApiKey() : undefined;
    if (isCloudProviderId(configuration.provider) && !credential) throw new Error(`No API key is stored for ${cloudProviderDefinition(configuration.provider).label}. Run 'Truss: Configure BYOK Provider'.`);
    const signature = JSON.stringify({ workspaceRoot: workspaceRoot(), provider: configuration.provider, credentialAccountId: configuration.credentialAccountId, baseUrl: configuration.baseUrl, model: configuration.model, internetAccess: configuration.internetAccess, mcpServers: configuration.mcpServers, hasCredential: Boolean(credential) });
    if (agentCoordinator && agentCoordinatorSignature === signature) return agentCoordinator;
    await disposeAgentCoordinator();
    const host = new AgentHost({
      workspaceRoot: workspaceRoot(),
      mcpServers: configuration.mcpServers,
      credentialResolver: {
        async resolve(reference, binding) {
          const accountReference =
            reference === "configuration"
              ? configuration.credentialAccountId
              : reference;
          const value =
            reference === "configuration" && credential
              ? credential
              : await providerApiKeyForReference(
                  binding.providerId as ModelProviderKind,
                  accountReference,
                );
          return value
            ? new ApiKeyCredential(`vscode-agent-${reference}`, value)
            : undefined;
        },
      },
      approvalFactory: dashboardApproval,
    });
    const coordinator = new AgentCoordinator({
      profiles: new FileAgentProfileStore(workspaceRoot()),
      runtimeFactory: host.createRuntimeFactory(),
      history: new FileAgentRunHistoryStore(workspaceRoot()),
    });
    await coordinator.restoreHistory();
    agentCoordinator = coordinator;
    agentCoordinatorSignature = signature;
    disposeAgentEvents = coordinator.events.subscribe((event) => {
      if (event.type === "run_updated") void agentPanel?.webview.postMessage({ type: "run", run: dashboardRun(event.run) });
      if (event.type === "runtime" && event.event.event.type === "tool_call_requested") {
        void agentPanel?.webview.postMessage({ type: "approval", runId: event.event.runId, callId: event.event.event.callId, tool: event.event.event.tool, input: event.event.event.input });
      }
    });
    return coordinator;
  };

  const stopTrussGo = (): void => { trussGoProcess?.kill(); trussGoProcess = undefined; };
  const connectTrussGo = async (): Promise<void> => {
    if (!configuration.model) throw new Error("Choose a local model before connecting Truss Go.");
    const address = detectLanAddress(); if (!address) throw new Error("Could not find a private Wi-Fi address for this computer.");
    stopTrussGo();
    const settings = vscode.workspace.getConfiguration("trussHarness");
    const configuredCommand = settings.get<string>("command", "").trim();
    const developmentCli = resolve(context.extensionPath, "../cli/dist/bin.js"); const bundledCli = resolve(context.extensionPath, "dist/truss-service.cjs");
    const command = configuredCommand || process.execPath;
    const commandArguments = configuredCommand ? [] : context.extensionMode === vscode.ExtensionMode.Development ? [developmentCli] : [bundledCli];
    const token = randomBytes(32).toString("hex");
    trussGoProcess = spawn(command, [...commandArguments, "gateway", "--gateway-host", address, "--gateway-port", "4787", "--gateway-token", token], { cwd: workspaceRoot(), windowsHide: true, env: await runtimeEnvironment() });
    await new Promise<void>((resolveReady, rejectReady) => {
      const child = trussGoProcess as ChildProcessWithoutNullStreams;
      const timeout = setTimeout(() => rejectReady(new Error("Truss Go gateway did not start in time.")), 8_000);
      child.once("error", (error) => { clearTimeout(timeout); rejectReady(error); });
      child.once("exit", (code) => { clearTimeout(timeout); rejectReady(new Error(`Truss Go gateway exited (${code ?? "unknown"}).`)); });
      child.stdout.on("data", (data: Buffer) => { if (data.toString().includes("mobile gateway listening")) { clearTimeout(timeout); resolveReady(); } });
    }).catch((error) => { stopTrussGo(); throw error; });
    const pairingUri = createPairingUri({ gatewayUrl: `http://${address}:4787`, token, workspaceName: vscode.workspace.name ?? "Workspace" });
    const qrDataUrl = await QRCode.toDataURL(pairingUri, { margin: 2, width: 320 });
    const panel = vscode.window.createWebviewPanel("trussHarnessGo", "Connect Truss Go", vscode.ViewColumn.Beside, { enableScripts: true });
    panel.webview.html = `<!doctype html><body style="font-family:system-ui;text-align:center;padding:24px"><h2>Connect Truss Go</h2><p>Scan in the Truss Go app on the same Wi-Fi.</p><img style="width:320px;max-width:100%" src="${qrDataUrl}"><p>${vscode.workspace.name ?? "Workspace"}</p><button id="disconnect">Disconnect</button><script>const v=acquireVsCodeApi();document.querySelector('#disconnect').onclick=()=>v.postMessage('disconnect')</script></body>`;
    panel.webview.onDidReceiveMessage((message) => { if (message === "disconnect") { stopTrussGo(); panel.dispose(); } }, undefined, context.subscriptions);
    panel.onDidDispose(stopTrussGo, undefined, context.subscriptions);
  };

  const post = (message: unknown): void => {
    void view?.webview.postMessage(message).then(undefined, () => undefined);
  };
  const disposeService = (): void => {
    service?.dispose();
    service = undefined;
    sessionId = undefined;
    activeChatRequest = undefined;
    activeChatConversationId = undefined;
    liveSessionIds.clear();
  };
  const startService = async (): Promise<RuntimeService> => {
    if (service) return service;
    if (!configuration.model) throw new Error("Choose a local model before starting the agent.");
    const settings = vscode.workspace.getConfiguration("trussHarness");
    const developmentCli = resolve(context.extensionPath, "../cli/dist/bin.js");
    const bundledCli = resolve(context.extensionPath, "dist/truss-service.cjs");
    const configuredCommand = settings.get<string>("command", "").trim();
    const useWorkspaceCli = context.extensionMode === vscode.ExtensionMode.Development && !configuredCommand;
    const useBundledCli = context.extensionMode !== vscode.ExtensionMode.Development && !configuredCommand;
    const command = configuredCommand || process.execPath;
    const commandArguments = useWorkspaceCli ? [developmentCli] : useBundledCli ? [bundledCli] : [];
    service = new RuntimeService(command, commandArguments, workspaceRoot(), {
      ...(await runtimeEnvironment()),
      ...(configuredCommand ? {} : { ELECTRON_RUN_AS_NODE: "1" })
    }, (message) => {
      if (message.event.type === "plan_updated" && message.event.plan) post({ type: "plan", plan: message.event.plan });
      if (message.requestId === activeChatRequest) {
        if (message.event.type === "text_delta") post({ type: "delta", conversationId: activeChatConversationId, text: message.event.text ?? "" });
        if (message.event.type === "tool_call_requested") {
          const tool = message.event.tool ?? "unknown";
          const isReadOnly = ["read_file", "list_directory", "search_files", "grep"].includes(tool);
          const requiresApproval = configuration.permission === "ask" || (configuration.permission === "auto-read" && !isReadOnly);
          post(requiresApproval
            ? { type: "approval", conversationId: activeChatConversationId, callId: message.event.callId, tool, input: message.event.input ?? {} }
            : { type: "tool", conversationId: activeChatConversationId, tool });
        }
      }
      const buffer = inlineBuffers.get(message.requestId);
      if (buffer !== undefined && message.event.type === "text_delta") {
        inlineBuffers.set(message.requestId, buffer + (message.event.text ?? ""));
      }
    }, (text) => {
      output.append(text);
      for (const line of text.split(/\r?\n/).filter((item) => item.startsWith("[mcp]"))) {
        post({ type: "mcpDiagnostic", message: line.replace(/^\[mcp\]\s*/, "") });
      }
    });
    context.subscriptions.push(service);
    return service;
  };

  const state = async (selectedConfiguration = configuration): Promise<HostState> => {
    if (!selectedConfiguration.model) {
      const isCurrentConfiguration = selectedConfiguration === configuration;
      const detected = isLocalConfiguration(selectedConfiguration) ? await detectActiveLocalModel() : undefined;
      if (detected) {
        selectedConfiguration = {
          ...selectedConfiguration,
          provider: detected.endpoint.kind,
          baseUrl: detected.endpoint.baseUrl,
          model: detected.model.name
        };
        if (isCurrentConfiguration) {
          configuration = selectedConfiguration;
          await context.workspaceState.update("modelConfiguration", configuration);
        }
      }
    }
    let models: readonly string[] = [];
    if (isLocalConfiguration(selectedConfiguration)) {
      try { models = (await listLocalModels(localEndpoint(selectedConfiguration))).map((model) => model.name); } catch { /* Manual names remain valid for custom endpoints. */ }
    }
    const endpoints = await detectLocalEndpoints();
    return {
      configuration: selectedConfiguration,
      endpoints,
      models,
      providerAccounts,
    };
  };
  const sendState = async (selectedConfiguration?: ModelConfiguration): Promise<void> => post({ type: "state", state: await state(selectedConfiguration) });
  const sendConversationState = (): void => post({ type: "conversations", state: conversations });
  const saveConversations = async (next: StoredConversationState): Promise<void> => {
    conversations = normalizeConversationState(next);
    await context.workspaceState.update("conversations", conversations);
  };

  const sendPrompt = async (prompt: string, conversationId: string, history: readonly ConversationMessage[], attachments?: readonly ChatAttachment[], attachedPaths?: readonly string[]): Promise<void> => {
    if (!prompt.trim()) return;
    const command = await executeWorkspaceCommand({ workspaceRoot: workspaceRoot(), input: prompt });
    if (command.handled) {
      post({ type: "delta", conversationId, text: command.message });
      post({ type: "assistantEnd", conversationId });
      return;
    }
    const current = await startService();
    sessionId = liveSessionIds.get(conversationId) ?? await current.createSession(normalizeHistory(history));
    liveSessionIds.set(conversationId, sessionId);
    post({ type: "assistantStart", conversationId });
    const run = current.run(prompt, sessionId, await workspaceFileContext(attachedPaths), attachments);
    activeChatRequest = run.requestId;
    activeChatConversationId = conversationId;
    try {
      const response = await run.result;
      sessionId = response.result.sessionId ?? sessionId;
      if (sessionId) liveSessionIds.set(conversationId, sessionId);
      post({ type: "session", conversationId });
      post({ type: "assistantEnd", conversationId, aborted: response.result.aborted === true });
    } catch (error) {
      post({ type: "error", conversationId, message: error instanceof Error ? error.message : String(error) });
    } finally {
      activeChatRequest = undefined;
      activeChatConversationId = undefined;
    }
  };

  const workingDiff = async (): Promise<string> => {
    const root = workspaceRoot();
    let diff = (await execFile("git", ["diff", "--cached", "--no-ext-diff"], { cwd: root, maxBuffer: 1_000_000 })).stdout;
    if (!diff.trim()) diff = (await execFile("git", ["diff", "--no-ext-diff"], { cwd: root, maxBuffer: 1_000_000 })).stdout;
    if (!diff.trim()) throw new Error("There are no staged or unstaged changes to summarize.");
    return diff;
  };

  const generateCommitMessage = async (): Promise<string> => {
    const diff = await workingDiff();
    return vscode.window.withProgress({
      location: vscode.ProgressLocation.SourceControl,
      title: `${brand.productName}: Generating commit message`,
      cancellable: true
    }, async (_progress, cancellationToken) => {
      const current = await startService();
      const run = current.run(`You write accurate, production-quality Git commit messages. Analyze the diff and return only one Conventional Commit message.

Requirements:
- First line format: type(optional scope): imperative summary
- Choose the most accurate type from feat, fix, refactor, perf, docs, test, build, ci, or chore.
- Keep the subject under 72 characters and describe the actual user-visible or technical change.
- Use specific verbs and nouns. Do not use vague wording such as "update", "changes", or "stuff".
- Add a blank line and a concise body only when it clarifies important behavior, constraints, or follow-up effects.
- Do not include Markdown, quotes, explanations, issue numbers, or text such as "Commit message:".

Diff:
${diff}`);
      inlineBuffers.set(run.requestId, "");
      const cancellation = cancellationToken.onCancellationRequested(() => current.abort(run.requestId));
      try {
        await run.result;
        const message = normalizeCommitMessage(inlineBuffers.get(run.requestId) ?? "");
        if (!message) throw new Error("The model returned an empty commit message.");
        return message;
      } finally {
        cancellation.dispose();
        inlineBuffers.delete(run.requestId);
      }
    });
  };

  const setGitCommitMessage = async (message: string): Promise<boolean> => {
    const gitExtension = vscode.extensions.getExtension<GitExtension>("vscode.git");
    if (!gitExtension) return false;
    if (!gitExtension.isActive) await gitExtension.activate();
    const repository = gitExtension.exports.getAPI(1).repositories.find((item) => item.rootUri.fsPath === workspaceRoot())
      ?? gitExtension.exports.getAPI(1).repositories[0];
    if (!repository) return false;
    repository.inputBox.value = message;
    return true;
  };

  const openAgentControlCenter = async (): Promise<void> => {
    if (agentPanel) {
      agentPanel.reveal(vscode.ViewColumn.Beside);
      await ensureAgentCoordinator();
      await sendAgentSnapshot();
      return;
    }
    const panel = vscode.window.createWebviewPanel("trussHarness.agentControlCenter", `${brand.productName}: Agent Control Center`, vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
    agentPanel = panel;
    panel.webview.html = agentControlCenterHtml(panel.webview);
    panel.onDidDispose(() => { if (agentPanel === panel) agentPanel = undefined; }, undefined, context.subscriptions);
    panel.webview.onDidReceiveMessage(async (message: AgentDashboardRequest) => {
      try {
        if (message.type === "ready") {
          await ensureAgentCoordinator();
          await sendAgentSnapshot();
          return;
        }
        if (message.type === "manageProfiles") {
          await vscode.commands.executeCommand("trussHarness.manageAgents");
          return;
        }
        const coordinator = await ensureAgentCoordinator();
        if (message.type === "start") {
          if (!message.agentId?.trim() || !message.prompt?.trim()) throw new Error("Choose an agent and enter a task.");
          await coordinator.start({ agentId: message.agentId, prompt: message.prompt });
          await sendAgentSnapshot();
          return;
        }
        if (message.type === "stop") {
          if (!message.runId?.trim()) throw new Error("Choose an agent run to stop.");
          await coordinator.stop(message.runId);
          await sendAgentSnapshot();
          return;
        }
        if (message.type === "resolveApproval") {
          if (!message.runId?.trim() || !message.callId?.trim()) throw new Error("The tool approval is incomplete.");
          if (!await coordinator.resolveApproval(message.runId, message.callId, message.approved)) throw new Error("That tool approval is no longer pending.");
          await sendAgentSnapshot();
        }
      } catch (error) {
        void panel.webview.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
      }
    }, undefined, context.subscriptions);
  };

  const bindWebview = (webview: vscode.Webview): void => {
    webview.options = { enableScripts: true };
    webview.html = webviewHtml(webview);
    webview.onDidReceiveMessage(async (message: WebviewRequest) => {
      switch (message.type) {
        case "ready":
          sendConversationState();
          await sendState();
          post({ type: "workspaceFiles", files: await workspaceFiles() });
          post({ type: "plan", plan: await activeWorkspacePlan() });
          break;
        case "discover":
          await sendState(isConfiguration(message.configuration) ? normalizeConfiguration(message.configuration) : undefined);
          break;
        case "configure":
          if (!isConfiguration(message.configuration) || !message.configuration.baseUrl) {
            post({ type: "error", message: "Choose a provider, endpoint, and model." });
            break;
          }
          const previousConfiguration = configuration;
          configuration = normalizeConfiguration(message.configuration);
          const detectedContextWindow = isLocalConfiguration(configuration)
            ? await detectLocalContextWindow(localEndpoint(configuration), configuration.model).catch(() => undefined)
            : undefined;
          if (detectedContextWindow) configuration = { ...configuration, contextWindow: detectedContextWindow };
          await context.workspaceState.update("modelConfiguration", configuration);
          disposeService();
          await disposeAgentCoordinator();
          if (previousConfiguration.model !== configuration.model || previousConfiguration.provider !== configuration.provider || previousConfiguration.baseUrl !== configuration.baseUrl) {
            void releaseOllamaModel(previousConfiguration);
          }
          post({ type: "runtimeReset" });
          await sendState();
          break;
        case "send":
          await sendPrompt(message.prompt, message.conversationId, message.history, message.attachments, message.attachedPaths);
          break;
        case "stop":
          if (activeChatRequest) service?.abort(activeChatRequest);
          break;
        case "newConversation":
          sessionId = undefined;
          post({ type: "conversationReset" });
          break;
        case "selectConversation":
          sessionId = liveSessionIds.get(message.conversationId);
          break;
        case "deleteConversation": {
          const wasActive = conversations.activeId === message.conversationId;
          if (activeChatConversationId === message.conversationId && activeChatRequest) service?.abort(activeChatRequest);
          conversations = normalizeConversationState({
            conversations: conversations.conversations.filter((conversation) => conversation.id !== message.conversationId),
            activeId: wasActive ? conversations.conversations.find((conversation) => conversation.id !== message.conversationId)?.id : conversations.activeId
          });
          liveSessionIds.delete(message.conversationId);
          if (wasActive) sessionId = conversations.activeId ? liveSessionIds.get(conversations.activeId) : undefined;
          await context.workspaceState.update("conversations", conversations);
          sendConversationState();
          break;
        }
        case "saveConversations":
          await saveConversations(message.state);
          break;
        case "toolApproval":
          if (activeChatRequest) service?.approve(activeChatRequest, message.callId, message.approved);
          break;
        case "connectTrussGo":
          await connectTrussGo().catch((error: unknown) => post({ type: "error", message: error instanceof Error ? error.message : String(error) }));
          break;
        case "manageMcp":
          await manageMcpServers().catch((error: unknown) =>
            post({
              type: "error",
              message: error instanceof Error ? error.message : String(error),
            }),
          );
          break;
      }
    }, undefined, context.subscriptions);
  };

  context.subscriptions.push(output, vscode.window.registerWebviewViewProvider("trussHarness.chat", {
    resolveWebviewView: (webviewView) => {
      view = webviewView;
      bindWebview(webviewView.webview);
      webviewView.onDidDispose(() => { view = undefined; }, undefined, context.subscriptions);
    }
  }));
  context.subscriptions.push({ dispose: () => { void disposeAgentCoordinator(); } });
  context.subscriptions.push(vscode.commands.registerCommand("trussHarness.openChat", () => vscode.commands.executeCommand("workbench.view.extension.trussHarness")));
  context.subscriptions.push(vscode.commands.registerCommand("trussHarness.openAgentControlCenter", () => openAgentControlCenter().catch((error: unknown) => vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error)))));
  context.subscriptions.push(vscode.commands.registerCommand("trussHarness.manageAgents", async () => {
    if (!configuration.model) throw new Error("Choose a model before managing agents.");
    const store = new FileAgentProfileStore(workspaceRoot());
    const profiles = await store.list();
    const choice = await vscode.window.showQuickPick([
      { label: "$(add) Create profile from current settings", action: "create" as const },
      ...profiles.map((profile) => ({ label: profile.displayName, description: `${profile.provider.providerId}/${profile.provider.modelId} · ${profile.mode}`, detail: profile.id, action: "show" as const }))
    ], { placeHolder: "Manage workspace-local Truss agent profiles" });
    if (!choice) return;
    if (choice.action === "create") {
      const name = await vscode.window.showInputBox({ prompt: "Agent profile name", validateInput: (value) => value.trim() ? undefined : "A name is required." });
      if (!name?.trim()) return;
      const runtime: ClientConfiguration = { workspaceRoot: workspaceRoot(), provider: configuration.provider, baseUrl: configuration.baseUrl, model: configuration.model, credentialRef: configuration.credentialAccountId, apiKey: await providerApiKey(), mode: configuration.mode, internetAccess: configuration.internetAccess, mcpServers: configuration.mcpServers };
      const profile = await store.create(profileFromConfiguration(runtime, name));
      await vscode.window.showInformationMessage(`${brand.productName} created agent profile ${profile.displayName}.`);
      await openAgentControlCenter();
      return;
    }
    await openAgentControlCenter();
  }));
  context.subscriptions.push(vscode.commands.registerCommand("trussHarness.connectTrussGo", () => connectTrussGo().catch((error: unknown) => vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error)))));
  context.subscriptions.push(vscode.commands.registerCommand("trussHarness.manageMcpServers", () => manageMcpServers().catch((error: unknown) => vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error)))));
  context.subscriptions.push(vscode.commands.registerCommand("trussHarness.testProviderConnection", () => testProviderConnection().catch((error: unknown) => vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error)))));
  context.subscriptions.push(vscode.commands.registerCommand("trussHarness.configureByokProvider", async () => {
    const selected = await vscode.window.showQuickPick(cloudProviderDefinitions.map((provider) => ({
      label: provider.label,
      description: provider.id,
      detail: provider.productionNote,
      provider
    })), { placeHolder: "Choose a cloud model provider" });
    if (!selected) return;
    await ensureProviderAccount(selected.provider.id);
    const existingAccounts = providerAccountsFor(selected.provider.id);
    const accountChoice = await vscode.window.showQuickPick([
      { label: "$(add) Create a new account", description: "Store another key", account: undefined },
      ...existingAccounts.map((account) => ({
        label: account.label,
        description: account.status,
        account,
      })),
    ], { placeHolder: `Choose a ${selected.label} account` });
    if (!accountChoice) return;
    let account = accountChoice.account;
    if (!account) {
      const label = await vscode.window.showInputBox({
        prompt: `${selected.label} account label`,
        value: `${selected.label} account`,
        validateInput: (value) => value.trim() ? undefined : "An account label is required.",
      });
      if (!label?.trim()) return;
      const timestamp = new Date().toISOString();
      account = {
        id: randomUUID(),
        providerId: selected.provider.id,
        label: label.trim(),
        authMethod: "api-key" as const,
        status: "active" as const,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    }
    const model = await vscode.window.showInputBox({
      prompt: `Model ID for ${selected.label}`,
      value: configuration.provider === selected.provider.id ? configuration.model : "",
      validateInput: (value) => value.trim() ? undefined : "A model ID is required."
    });
    if (!model?.trim()) return;
    const apiKey = await vscode.window.showInputBox({
      prompt: `${selected.label} API key`,
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => value.trim() ? undefined : "An API key is required."
    });
    if (!apiKey?.trim()) return;

    account = {
      ...account,
      status: "active",
      updatedAt: new Date().toISOString(),
    };
    providerAccounts = [
      ...providerAccounts.filter((candidate) => candidate.id !== account.id),
      account,
    ];
    await persistProviderAccounts();
    await context.secrets.store(credentialKey(account.id), apiKey.trim());
    configuration = {
      ...configuration,
      provider: selected.provider.id,
      baseUrl: selected.provider.baseUrl,
      model: model.trim(),
      credentialAccountId: account.id,
    };
    await context.workspaceState.update("modelConfiguration", configuration);
    disposeService();
    await disposeAgentCoordinator();
    post({ type: "runtimeReset" });
    await sendState();
    void vscode.window.showInformationMessage(`${brand.productName} is configured for ${selected.label} / ${account.label}. Its API key is stored in VS Code Secret Storage.`);
  }));
  context.subscriptions.push(vscode.commands.registerCommand("trussHarness.removeByokCredential", async () => {
    const selectedProvider = await vscode.window.showQuickPick(cloudProviderDefinitions.map((provider) => ({ label: provider.label, description: provider.id, provider })), { placeHolder: "Choose a provider" });
    if (!selectedProvider) return;
    const account = await ensureProviderAccount(selectedProvider.provider.id);
    if (!account) return;
    const selectedAccount = await vscode.window.showQuickPick(
      providerAccountsFor(selectedProvider.provider.id).map((candidate) => ({
        label: candidate.label,
        description: candidate.status,
        account: candidate,
      })),
      { placeHolder: `Remove a ${selectedProvider.label} account key` },
    );
    if (!selectedAccount) return;
    await context.secrets.delete(credentialKey(selectedAccount.account.id));
    if (configuration.provider === selectedProvider.provider.id && configuration.credentialAccountId === selectedAccount.account.id) {
      disposeService();
      await disposeAgentCoordinator();
    }
    void vscode.window.showInformationMessage(`${brand.productName} removed the stored ${selectedProvider.label} account key.`);
  }));
  context.subscriptions.push(vscode.commands.registerCommand("trussHarness.generateCommitMessage", async () => {
    try {
      const message = await generateCommitMessage();
      if (await setGitCommitMessage(message)) {
        void vscode.window.showInformationMessage(`${brand.productName} filled the Git commit-message input.`);
      } else {
        await vscode.env.clipboard.writeText(message);
        void vscode.window.showInformationMessage(`${brand.productName} copied the commit message to the clipboard.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.appendLine(`Commit message generation failed: ${message}`);
      void vscode.window.showErrorMessage(`${brand.productName}: ${message}`);
    }
  }));
  const runWorkspaceCommand = async (input: string): Promise<void> => {
    const result = await executeWorkspaceCommand({ workspaceRoot: workspaceRoot(), input });
    output.appendLine(result.message);
    if (view) post({ type: "workspaceCommand", command: input, message: result.message });
    if (result.ok) void vscode.window.showInformationMessage(result.message.split("\n")[0]);
    else void vscode.window.showErrorMessage(result.message.split("\n")[0]);
  };
  context.subscriptions.push(vscode.commands.registerCommand("trussHarness.initializeWorkspace", () => runWorkspaceCommand("/init")));
  context.subscriptions.push(vscode.commands.registerCommand("trussHarness.updateWorkspaceMemory", () => runWorkspaceCommand("/update")));
  context.subscriptions.push(vscode.commands.registerCommand("trussHarness.showWorkspaceStatus", () => runWorkspaceCommand("/status")));
  context.subscriptions.push(vscode.commands.registerCommand("trussHarness.clearWorkspaceMemory", () => runWorkspaceCommand("/clear-memory")));
  context.subscriptions.push(vscode.languages.registerInlineCompletionItemProvider({ pattern: "**" }, {
    provideInlineCompletionItems: async (document, position, _context, cancellationToken) => {
      if (!configuration.model || activeChatRequest || cancellationToken.isCancellationRequested) return undefined;
      const prefixStart = new vscode.Position(Math.max(0, position.line - 16), 0);
      const prefix = document.getText(new vscode.Range(prefixStart, position));
      const suffixEnd = new vscode.Position(Math.min(document.lineCount - 1, position.line + 6), document.lineAt(Math.min(document.lineCount - 1, position.line + 6)).range.end.character);
      const suffix = document.getText(new vscode.Range(position, suffixEnd));
      const prompt = `Complete the code at <cursor>. Return only code to insert, with no markdown or explanation.\n\n${prefix}<cursor>${suffix}`;
      let requestId: string | undefined;
      try {
        const current = await startService();
        const run = current.run(prompt);
        requestId = run.requestId;
        inlineBuffers.set(run.requestId, "");
        await run.result;
        const completion = inlineBuffers.get(run.requestId)?.trim();
        inlineBuffers.delete(run.requestId);
        if (!completion || cancellationToken.isCancellationRequested) return undefined;
        return [new vscode.InlineCompletionItem(completion, new vscode.Range(position, position))];
      } catch {
        if (requestId) inlineBuffers.delete(requestId);
        return undefined;
      }
    }
  }));
}

export function deactivate(): void {}

function agentControlCenterHtml(webview: vscode.Webview): string {
  const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
body { color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); margin: 0; }
main { max-width: 920px; margin: 0 auto; padding: 24px; display: grid; gap: 20px; }
h1 { font-size: 20px; margin: 0; } h2 { font-size: 12px; letter-spacing: .6px; color: var(--vscode-descriptionForeground); margin: 0 0 9px; } p { color: var(--vscode-descriptionForeground); line-height: 1.5; margin: 5px 0 0; }
.top, .run-head, .approval-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; } .card { display: grid; gap: 11px; padding: 14px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; background: var(--vscode-sideBar-background); } .grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: 12px; }
label { display: grid; gap: 5px; color: var(--vscode-descriptionForeground); font-size: 12px; } select, textarea { box-sizing: border-box; width: 100%; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); border-radius: 3px; padding: 7px; font: inherit; } textarea { min-height: 90px; resize: vertical; }
button { min-height: 30px; padding: 5px 10px; border: 1px solid var(--vscode-button-border, transparent); border-radius: 3px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; } button.secondary { color: var(--vscode-foreground); background: transparent; border-color: var(--vscode-panel-border); } button.danger { color: var(--vscode-errorForeground); background: transparent; border-color: var(--vscode-errorForeground); } button:disabled { cursor: default; opacity: .55; }
.runs { display: grid; gap: 8px; } .run { display: grid; gap: 8px; padding: 12px; border: 1px solid var(--vscode-panel-border); border-radius: 5px; } .state { color: var(--vscode-terminal-ansiGreen); font-size: 12px; text-transform: capitalize; } .state.waiting_for_approval { color: var(--vscode-editorWarning-foreground); } .state.failed { color: var(--vscode-errorForeground); } .detail { color: var(--vscode-descriptionForeground); font-size: 12px; overflow-wrap: anywhere; } #approval { display: none; border-color: var(--vscode-editorWarning-foreground); } #approval.open { display: grid; } #status { min-height: 18px; color: var(--vscode-descriptionForeground); font-size: 12px; } #status.error { color: var(--vscode-errorForeground); } .empty { color: var(--vscode-descriptionForeground); font-style: italic; }
@media (max-width: 620px) { main { padding: 14px; } .grid { grid-template-columns: 1fr; } }
</style></head><body><main>
<div class="top"><div><h1>Agent Control Center</h1><p>Run independent profiles in this workspace. Providers, models, and permissions remain local to VS Code.</p></div><button id="manage" class="secondary">Manage profiles</button></div>
<div class="card"><h2>START AN AGENT</h2><div class="grid"><label>Profile<select id="profile"></select></label><label>Task<textarea id="prompt" placeholder="Give this agent a focused task"></textarea></label></div><div><button id="start">Start agent</button></div></div>
<div id="approval" class="card"><div class="approval-head"><div><h2>TOOL APPROVAL</h2><strong id="approvalTitle">Agent needs approval</strong></div><span class="state waiting_for_approval">Waiting</span></div><p id="approvalInput"></p><div><button id="deny" class="danger">Deny</button> <button id="allow">Allow tool</button></div></div>
<section><div class="top"><h2>AGENT RUNS</h2><button id="refresh" class="secondary">Refresh</button></div><div id="runs" class="runs"><div class="empty">Loading agent profiles…</div></div></section><div id="status"></div>
</main><script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const profiles = new Map(); const runs = new Map(); let pendingApproval;
const profileSelect = document.querySelector('#profile'); const prompt = document.querySelector('#prompt'); const runsElement = document.querySelector('#runs'); const status = document.querySelector('#status'); const approval = document.querySelector('#approval');
const post = (message) => vscode.postMessage(message);
const setStatus = (message, error = false) => { status.textContent = message || ''; status.className = error ? 'error' : ''; };
const text = (tag, value, className) => { const element = document.createElement(tag); element.textContent = value; if (className) element.className = className; return element; };
const active = (state) => ['queued', 'running', 'waiting_for_approval'].includes(state);
function renderProfiles() { const selected = profileSelect.value; profileSelect.replaceChildren(); for (const profile of profiles.values()) { const option = document.createElement('option'); option.value = profile.id; option.textContent = profile.displayName + ' — ' + profile.provider + '/' + profile.model + ' · ' + profile.mode; profileSelect.append(option); } if (profiles.has(selected)) profileSelect.value = selected; document.querySelector('#start').disabled = profiles.size === 0; }
function renderRuns() { runsElement.replaceChildren(); if (!runs.size) { runsElement.append(text('div', 'No agent runs yet.', 'empty')); return; } for (const run of [...runs.values()].reverse()) { const owner = profiles.get(run.agentId); const card = document.createElement('article'); card.className = 'run'; const head = document.createElement('div'); head.className = 'run-head'; const name = document.createElement('div'); name.append(text('strong', owner ? owner.displayName : 'Managed agent')); name.append(text('div', owner ? owner.provider + '/' + owner.model : run.agentId, 'detail')); head.append(name); head.append(text('span', run.state.replaceAll('_', ' '), 'state ' + run.state)); card.append(head); if (run.latestProgress) card.append(text('div', run.latestProgress, 'detail')); if (run.output) card.append(text('pre', run.output, 'detail')); if (run.activeTool) card.append(text('div', 'Active tool: ' + run.activeTool.name, 'detail')); if (run.changedFiles && run.changedFiles.length) card.append(text('div', run.changedFiles.length + ' changed file' + (run.changedFiles.length === 1 ? '' : 's'), 'detail')); if (run.error) card.append(text('div', run.error, 'detail')); if (active(run.state)) { const stop = text('button', 'Stop agent', 'danger'); stop.onclick = () => post({ type: 'stop', runId: run.id }); card.append(stop); } runsElement.append(card); } }
function renderApproval() { if (!pendingApproval) { approval.className = 'card'; return; } approval.className = 'card open'; document.querySelector('#approvalTitle').textContent = 'Allow ' + pendingApproval.tool.replaceAll('_', ' ') + '?'; document.querySelector('#approvalInput').textContent = JSON.stringify(pendingApproval.input, null, 2); }
document.querySelector('#start').onclick = () => { const task = prompt.value.trim(); if (!task) return setStatus('Enter a task before starting an agent.', true); post({ type: 'start', agentId: profileSelect.value, prompt: task }); prompt.value = ''; };
document.querySelector('#refresh').onclick = () => post({ type: 'ready' }); document.querySelector('#manage').onclick = () => post({ type: 'manageProfiles' }); document.querySelector('#allow').onclick = () => { if (pendingApproval) post({ ...pendingApproval, type: 'resolveApproval', approved: true }); pendingApproval = undefined; renderApproval(); }; document.querySelector('#deny').onclick = () => { if (pendingApproval) post({ ...pendingApproval, type: 'resolveApproval', approved: false }); pendingApproval = undefined; renderApproval(); };
window.addEventListener('message', ({ data: message }) => { if (message.type === 'state') { profiles.clear(); runs.clear(); for (const profile of message.profiles || []) profiles.set(profile.id, profile); for (const run of message.runs || []) runs.set(run.id, run); renderProfiles(); renderRuns(); setStatus(''); } if (message.type === 'run') { runs.set(message.run.id, message.run); renderRuns(); } if (message.type === 'approval') { pendingApproval = message; renderApproval(); } if (message.type === 'error') setStatus(message.message, true); });
post({ type: 'ready' });
</script></body></html>`;
}

function legacyWebviewHtml(webview: vscode.Webview): string {
  const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  :root { color-scheme: dark light; font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
  body { margin: 0; height: 100vh; display: grid; grid-template-rows: auto 1fr auto; overflow: hidden; }
  header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--vscode-panel-border); }
  header strong { margin-right: auto; } button, select, input, textarea { font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); border-radius: 3px; }
  button { padding: 5px 9px; cursor: pointer; } button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: transparent; } button:hover { background: var(--vscode-button-hoverBackground); }
  #chat { padding: 14px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }
  .message { max-width: 88%; white-space: pre-wrap; line-height: 1.45; padding: 8px 10px; border-radius: 5px; border: 1px solid var(--vscode-panel-border); }
  .user { align-self: flex-end; background: var(--vscode-textBlockQuote-background); } .assistant { align-self: flex-start; } .tool { align-self: flex-start; font-size: .9em; opacity: .8; }
  #composer { padding: 10px 12px; border-top: 1px solid var(--vscode-panel-border); display: grid; grid-template-columns: 1fr auto auto; gap: 8px; }
  textarea { min-height: 42px; resize: vertical; padding: 7px; }
  #settings { display: none; position: absolute; inset: 48px 12px auto 12px; z-index: 2; padding: 12px; border: 1px solid var(--vscode-panel-border); background: var(--vscode-editor-background); box-shadow: 0 4px 18px #0005; }
  #settings.open { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)) auto; gap: 8px; align-items: end; } label { display: grid; gap: 4px; font-size: .85em; } input, select { padding: 6px; min-width: 0; } #status { font-size: .85em; opacity: .8; }
</style></head><body>
<header><strong>Truss</strong><span id="status">Choose a local model</span><button id="new" title="New conversation">New</button><button id="commit" title="Generate a commit message from the current Git diff">Commit message</button><button id="settingsButton" title="Configure local model server">Model</button></header>
<section id="settings"><label>Detected server<select id="server"><option value="">Custom / manual</option></select></label><label>Provider<select id="provider"><option value="ollama">Ollama</option><option value="openai-compatible">LM Studio / compatible</option><option value="openai">OpenAI (use Configure BYOK Provider)</option><option value="anthropic">Anthropic (use Configure BYOK Provider)</option><option value="openrouter">OpenRouter (use Configure BYOK Provider)</option><option value="groq">Groq (use Configure BYOK Provider)</option><option value="together">Together AI (use Configure BYOK Provider)</option><option value="gemini">Gemini (use Configure BYOK Provider)</option><option value="xai">xAI (use Configure BYOK Provider)</option><option value="mistral">Mistral AI (use Configure BYOK Provider)</option><option value="deepseek">DeepSeek (use Configure BYOK Provider)</option><option value="perplexity">Perplexity (use Configure BYOK Provider)</option><option value="fireworks">Fireworks AI (use Configure BYOK Provider)</option><option value="nvidia-nim">NVIDIA NIM (use Configure BYOK Provider)</option></select></label><label>Endpoint<input id="endpoint" placeholder="http://127.0.0.1:11434"></label><label>Model<input id="model" list="models" placeholder="Refresh to discover models"><datalist id="models"></datalist></label><button id="refresh">Refresh</button><button id="apply" class="primary">Use model</button></section>
<main id="chat"></main><form id="composer"><textarea id="prompt" placeholder="Ask about this workspace" rows="2"></textarea><button id="stop" type="button">Stop</button><button class="primary" type="submit">Send</button></form>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi(); const chat = document.getElementById('chat'); const settings = document.getElementById('settings'); const status = document.getElementById('status');
  const server = document.getElementById('server'); const provider = document.getElementById('provider'); const endpoint = document.getElementById('endpoint'); const model = document.getElementById('model'); const modelOptions = document.getElementById('models'); const prompt = document.getElementById('prompt'); let active;
  const add = (kind, text) => { const item = document.createElement('div'); item.className = 'message ' + kind; item.textContent = text; chat.append(item); chat.scrollTop = chat.scrollHeight; return item; };
  const configuration = () => ({ provider: provider.value, baseUrl: endpoint.value.trim(), model: model.value });
  document.getElementById('settingsButton').onclick = () => settings.classList.toggle('open');
  document.getElementById('new').onclick = () => vscode.postMessage({ type: 'newConversation' });
  document.getElementById('commit').onclick = () => vscode.postMessage({ type: 'commitMessage' });
  document.getElementById('stop').onclick = () => vscode.postMessage({ type: 'stop' });
  server.onchange = () => { const value = server.value; if (!value) return; const selected = JSON.parse(value); provider.value = selected.kind; endpoint.value = selected.baseUrl; vscode.postMessage({ type: 'discover', configuration: configuration() }); };
  document.getElementById('refresh').onclick = () => vscode.postMessage({ type: 'discover', configuration: configuration() });
  document.getElementById('apply').onclick = () => vscode.postMessage({ type: 'configure', configuration: configuration() });
  document.getElementById('composer').onsubmit = (event) => { event.preventDefault(); const text = prompt.value.trim(); if (!text) return; add('user', text); prompt.value = ''; vscode.postMessage({ type: 'send', prompt: text }); };
  window.addEventListener('message', (event) => { const message = event.data;
    if (message.type === 'state') { const state = message.state; provider.value = state.configuration.provider; endpoint.value = state.configuration.baseUrl; model.value = state.configuration.model; modelOptions.replaceChildren(...state.models.map((name) => { const option = document.createElement('option'); option.value = name; return option; })); server.replaceChildren(...[{ label: 'Custom / manual', kind: '', baseUrl: '' }, ...state.endpoints].map((item) => { const option = document.createElement('option'); option.value = item.kind ? JSON.stringify(item) : ''; option.textContent = item.label + (item.baseUrl ? ' (' + item.baseUrl + ')' : ''); return option; })); status.textContent = model.value ? model.value + ' at ' + endpoint.value : 'Choose a local model'; }
    if (message.type === 'assistantStart') active = add('assistant', '');
    if (message.type === 'delta' && active) { active.textContent += message.text; chat.scrollTop = chat.scrollHeight; }
    if (message.type === 'approval') { const item = add('tool', 'Allow ' + message.tool + ' ' + JSON.stringify(message.input) + '? '); const allow = document.createElement('button'); allow.textContent = 'Allow'; const deny = document.createElement('button'); deny.textContent = 'Deny'; allow.onclick = () => { vscode.postMessage({ type: 'toolApproval', callId: message.callId, approved: true }); item.replaceChildren(document.createTextNode('Allowed ' + message.tool)); }; deny.onclick = () => { vscode.postMessage({ type: 'toolApproval', callId: message.callId, approved: false }); item.replaceChildren(document.createTextNode('Denied ' + message.tool)); }; item.append(allow, deny); }
    if (message.type === 'assistantEnd') active = undefined;
    if (message.type === 'conversationReset') { chat.replaceChildren(); active = undefined; }
    if (message.type === 'error') { add('tool', 'Error: ' + message.message); active = undefined; }
  }); vscode.postMessage({ type: 'ready' });
</script></body></html>`;
}

function webviewHtml(webview: vscode.Webview): string {
  const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return String.raw`<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  :root { color-scheme: dark light; font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-sideBar-background); }
  html, body { width: 100%; height: 100%; min-height: 0; overflow: hidden; } * { box-sizing: border-box; } body { position: fixed; inset: 0; margin: 0; min-width: 0; display: flex; flex-direction: column; overflow: hidden; font-size: 13px; }
  button, select, input, textarea { font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); border-radius: 4px; }
  button { min-height: 28px; padding: 4px 8px; cursor: pointer; } button:hover { background: var(--vscode-button-hoverBackground); } button.primary { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border-color: var(--vscode-button-background); }
  button:focus-visible, select:focus-visible, input:focus-visible, textarea:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
  header { flex: 0 0 auto; padding: 11px 10px 9px; border-bottom: 1px solid var(--vscode-panel-border); display: grid; gap: 9px; background: var(--vscode-sideBar-background); } .brand-row, .actions, .segmented { display: flex; align-items: center; gap: 5px; min-width: 0; } .brand { font-weight: 700; letter-spacing: .2px; white-space: nowrap; margin-right: auto; } #modelStatus { color: var(--vscode-descriptionForeground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } 
  .segmented { padding: 2px; border: 1px solid var(--vscode-panel-border); border-radius: 5px; } .segmented button { border: 0; background: transparent; min-height: 24px; padding: 3px 7px; } .segmented button.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); box-shadow: inset 0 0 0 1px var(--vscode-focusBorder); }
  #telemetry { display: grid; grid-template-columns: minmax(130px, 1fr) auto; align-items: center; gap: 10px; min-width: 0; color: var(--vscode-descriptionForeground); font-size: 11px; } .telemetry-context { min-width: 0; display: grid; grid-template-columns: auto minmax(52px, 1fr); gap: 5px 7px; align-items: center; } .telemetry-label { color: var(--vscode-descriptionForeground); font-size: 10px; font-weight: 700; letter-spacing: .35px; } #contextValue, #rateValue { color: var(--vscode-foreground); font-variant-numeric: tabular-nums; white-space: nowrap; } .meter { height: 4px; min-width: 0; overflow: hidden; background: var(--vscode-progressBar-background); border-radius: 999px; } .meter > span { display: block; width: 0; height: 100%; background: var(--vscode-progressBar-background, var(--vscode-focusBorder)); border-radius: inherit; transition: width 120ms linear, background-color 120ms linear; } .meter > span.active { background: var(--vscode-focusBorder); } .meter > span.warning { background: var(--vscode-editorWarning-foreground); } .meter > span.critical { background: var(--vscode-editorError-foreground); }
  #settings { display: none; flex: 0 1 auto; max-height: 52vh; overflow: auto; padding: 10px; gap: 8px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-editor-background); } #settings.open { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); } label { min-width: 0; display: grid; gap: 4px; color: var(--vscode-descriptionForeground); font-size: 11px; } input, select { width: 100%; min-width: 0; padding: 5px 6px; } #settings .actions { align-self: end; } .mcp-setting, #mcpStatus { grid-column: 1 / -1; } .mcp-setting textarea { min-height: 96px; max-height: 180px; resize: vertical; font-family: var(--vscode-editor-font-family); font-size: 11px; line-height: 1.45; } #mcpStatus { color: var(--vscode-descriptionForeground); font-size: 11px; overflow-wrap: anywhere; }
  #workspace { flex: 1 1 0; min-width: 0; min-height: 0; overflow: hidden; display: grid; grid-template-columns: minmax(118px, 30%) minmax(0, 1fr); } #history { min-width: 0; min-height: 0; overflow-y: auto; overflow-x: hidden; border-right: 1px solid var(--vscode-panel-border); padding: 7px; } .history-title { color: var(--vscode-descriptionForeground); font-size: 11px; text-transform: uppercase; margin: 2px 3px 7px; } .conversation-row { display: grid; grid-template-columns: minmax(0, 1fr) 24px; align-items: center; margin-bottom: 2px; } .conversation { display: block; width: 100%; text-align: left; background: transparent; border: 0; border-radius: 3px; padding: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } .conversation.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); } .delete-conversation { min-height: 24px; padding: 0; border: 0; background: transparent; color: var(--vscode-descriptionForeground); } .delete-conversation:hover { color: var(--vscode-errorForeground); background: var(--vscode-list-hoverBackground); }
  #chat { min-width: 0; min-height: 0; height: 100%; padding: 12px; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; display: flex; flex-direction: column; gap: 12px; } .plan { display: grid; gap: 4px; padding: 8px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; background: var(--vscode-textBlockQuote-background); font-size: 12px; } .plan strong { overflow-wrap: anywhere; } .plan-step { overflow-wrap: anywhere; color: var(--vscode-descriptionForeground); } .plan-step.in_progress { color: var(--vscode-editorWarning-foreground); } .plan-step.completed { color: var(--vscode-terminal-ansiGreen); text-decoration: line-through; } .empty { color: var(--vscode-descriptionForeground); line-height: 1.5; margin: auto 0; } .message { white-space: pre-wrap; line-height: 1.5; overflow-wrap: anywhere; } .message-header { color: var(--vscode-descriptionForeground); font-size: 11px; font-weight: 700; margin-bottom: 3px; } .message.user { padding-left: 8px; border-left: 2px solid var(--vscode-focusBorder); } .message.assistant { padding-left: 8px; border-left: 2px solid var(--vscode-terminal-ansiGreen); } .tool { padding: 7px; border: 1px solid var(--vscode-panel-border); background: var(--vscode-textBlockQuote-background); border-radius: 4px; color: var(--vscode-descriptionForeground); } .tool button { margin: 6px 4px 0 0; }
  #composer { flex: 0 0 auto; min-width: 0; min-height: 0; position: relative; z-index: 1; display: grid; grid-template-columns: minmax(0, 1fr) auto auto auto; gap: 6px; padding: 9px 10px 6px; border-top: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); box-shadow: 0 -3px 10px color-mix(in srgb, var(--vscode-sideBar-background) 78%, transparent); } textarea { min-height: 36px; max-height: 120px; resize: vertical; padding: 7px; } #attachments { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 5px; } .attachment { display: inline-flex; align-items: center; gap: 5px; max-width: 180px; padding: 3px 5px; border: 1px solid var(--vscode-panel-border); background: var(--vscode-textBlockQuote-background); font-size: 11px; } .attachment span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .attachment img { width: 32px; height: 28px; object-fit: cover; } .attachment button { min-height: 20px; padding: 0 4px; } .message-attachments { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 7px; } #stop { display: none; } body.streaming #stop { display: inline-block; } body.streaming #send { display: none; } #agentControls { flex: 0 0 auto; min-width: 0; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 7px; align-items: center; padding: 0 10px 9px; background: var(--vscode-sideBar-background); } .quick-model { min-width: 0; display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 5px; } .quick-model span { color: var(--vscode-descriptionForeground); font-size: 10px; font-weight: 700; letter-spacing: .35px; } #quickModel { min-width: 0; height: 28px; padding: 3px 6px; }
  .message { white-space: normal; } .markdown > :first-child { margin-top: 0; } .markdown > :last-child { margin-bottom: 0; } .markdown p { margin: 0 0 8px; white-space: pre-wrap; } .markdown h1, .markdown h2, .markdown h3, .markdown h4 { margin: 12px 0 6px; font-size: 14px; line-height: 1.35; } .markdown ul { margin: 4px 0 8px; padding-left: 19px; } .markdown blockquote { margin: 7px 0; padding-left: 8px; border-left: 2px solid var(--vscode-textBlockQuote-border); color: var(--vscode-descriptionForeground); } .markdown code { padding: 1px 4px; border-radius: 3px; background: var(--vscode-textCodeBlock-background); font-family: var(--vscode-editor-font-family); font-size: .92em; } .thinking { color: var(--vscode-descriptionForeground); font-size: 12px; white-space: nowrap; animation: thinking-pulse 1.2s ease-in-out infinite; } @keyframes thinking-pulse { 0%, 100% { opacity: .45; } 50% { opacity: 1; } } .code-block { min-width: 0; max-width: 100%; overflow: hidden; margin: 9px 0; border: 1px solid var(--vscode-panel-border); border-radius: 4px; background: var(--vscode-textCodeBlock-background); } .code-language { padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border); color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family); font-size: 10px; text-transform: uppercase; } .code-block pre { min-width: 0; margin: 0; overflow: hidden; padding: 9px; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; } .code-block code { display: block; min-width: 0; padding: 0; background: transparent; font-family: var(--vscode-editor-font-family); font-size: 12px; line-height: 1.55; white-space: inherit; overflow-wrap: inherit; word-break: inherit; } .token-comment { color: var(--vscode-editorCodeLens-foreground); } .token-string { color: var(--vscode-terminal-ansiYellow); } .token-keyword { color: var(--vscode-terminal-ansiBlue); } .token-number { color: var(--vscode-terminal-ansiMagenta); } .markdown a { color: var(--vscode-textLink-foreground); } #composer { position: relative; } #slashMenu { position: absolute; z-index: 4; right: 10px; bottom: calc(100% - 2px); left: 10px; max-height: 220px; overflow: auto; padding: 4px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; background: var(--vscode-editorWidget-background); box-shadow: 0 -8px 24px #0006; } .slash-option { display: block; width: 100%; min-height: 27px; border: 0; border-radius: 3px; background: transparent; text-align: left; font-family: var(--vscode-editor-font-family); font-size: 12px; } .slash-option:hover, .slash-option.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  @media (max-width: 700px) { #settings.open { grid-template-columns: repeat(2, minmax(0, 1fr)); } } @media (max-width: 560px) { header { padding: 8px; } .brand-row { flex-wrap: wrap; } #telemetry { width: 100%; } #workspace { grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr); } #history { display: flex; gap: 4px; overflow-x: auto; overflow-y: hidden; padding: 5px; border-right: 0; border-bottom: 1px solid var(--vscode-panel-border); } .history-title { display: none; } .conversation-row { display: flex; min-width: 122px; } .conversation { width: auto; min-width: 96px; } #settings.open { grid-template-columns: 1fr; } #composer { grid-template-columns: minmax(0, 1fr) auto; } #stop, #send { grid-column: 2; } #agentControls { grid-template-columns: 1fr; } .quick-model { grid-template-columns: auto minmax(0, 1fr); } }
</style></head><body>
<header><div class="brand-row"><span class="brand">${brand.productName}</span><button id="new" title="New conversation">New</button><button id="help" title="Show local workspace commands">Help</button><button id="settingsButton" title="Model and agent settings">Settings</button></div><div id="telemetry"><div class="telemetry-context" title="Estimated from the active conversation. Local model servers do not consistently report prompt-token usage."><span class="telemetry-label">CONTEXT</span><span id="contextValue">0 / 8.2k</span><div class="meter"><span id="contextMeter"></span></div></div><div title="Estimated from streamed response text"><span class="telemetry-label">SPEED </span><span id="rateValue">-- tok/s</span></div></div></header>
<section id="settings"><label>Detected server<select id="server"><option value="">Custom / manual</option></select></label><label>Provider<select id="provider"><option value="ollama">Ollama</option><option value="openai-compatible">Compatible API</option><option value="openai">OpenAI (use Configure BYOK Provider)</option><option value="anthropic">Anthropic (use Configure BYOK Provider)</option><option value="openrouter">OpenRouter (use Configure BYOK Provider)</option><option value="groq">Groq (use Configure BYOK Provider)</option><option value="together">Together AI (use Configure BYOK Provider)</option><option value="gemini">Gemini (use Configure BYOK Provider)</option><option value="xai">xAI (use Configure BYOK Provider)</option><option value="mistral">Mistral AI (use Configure BYOK Provider)</option><option value="deepseek">DeepSeek (use Configure BYOK Provider)</option><option value="perplexity">Perplexity (use Configure BYOK Provider)</option><option value="fireworks">Fireworks AI (use Configure BYOK Provider)</option><option value="nvidia-nim">NVIDIA NIM (use Configure BYOK Provider)</option></select></label><label>Endpoint<input id="endpoint" placeholder="http://127.0.0.1:11434"></label><label>Model<input id="model" list="models" placeholder="Refresh to discover models"><datalist id="models"></datalist></label><label>Context window<input id="contextWindow" type="number" min="512" max="1000000" step="512" value="8192"></label><label>Tool permissions<select id="permission"><option value="ask">Ask every time</option><option value="auto-read">Auto-allow read-only</option><option value="auto-all">Auto-allow all tools</option></select></label><label>Internet research<select id="internetAccess"><option value="false">Disabled</option><option value="true">Enabled</option></select></label><label class="mcp-setting">Advanced MCP JSON import/export<textarea id="mcpServers" rows="7" spellcheck="false" placeholder='{"filesystem":{"command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","."]}}'></textarea></label><div id="mcpStatus">No MCP servers configured.</div><div class="actions"><button id="manageMcp" type="button">Manage MCP</button><button id="refresh">Refresh</button><button id="apply" class="primary">Apply</button></div></section>
<main id="workspace"><aside id="history"><div class="history-title">Conversations</div></aside><section id="chat"><div class="empty">Select a local model in Settings, then ask about the workspace. Use Plan for read-only investigation and Agent when you want the agent to change files or run commands.</div></section></main>
<form id="composer"><div id="slashMenu" role="listbox" hidden></div><div id="attachments" hidden></div><textarea id="prompt" placeholder="Ask about this workspace. Type @/ to attach a file; /help for commands." rows="2"></textarea><input id="attachmentInput" type="file" multiple hidden><button id="attach" type="button" title="Attach images or text files">Attach</button><button id="stop" type="button">Cancel</button><button id="send" class="primary" type="submit">Send</button></form>
<section id="agentControls" aria-label="Agent controls"><div class="segmented" aria-label="Agent mode"><button data-mode="chat">Chat</button><button data-mode="plan">Plan</button><button data-mode="edit">Agent</button></div><label class="quick-model"><span>MODEL</span><select id="quickModel" title="Switch local model"></select></label><span id="modelStatus">Choose a local model</span></section>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi(); const savedState = vscode.getState(); const state = savedState && typeof savedState === 'object' && Array.isArray(savedState.conversations) ? savedState : { conversations: [], activeId: undefined }; state.conversations = state.conversations.filter((item) => item && typeof item === 'object' && typeof item.id === 'string').map((item) => ({ ...item, title: typeof item.title === 'string' ? item.title : 'Conversation', messages: Array.isArray(item.messages) ? item.messages.filter((message) => message && (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string') : [], updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString() })); if (!state.conversations.some((item) => item.id === state.activeId)) state.activeId = state.conversations[0]?.id; vscode.setState(state); const history = document.getElementById('history'); const chat = document.getElementById('chat'); const settings = document.getElementById('settings'); const status = document.getElementById('modelStatus'); let persistTimer; let activePlan;
  const server = document.getElementById('server'); const provider = document.getElementById('provider'); const endpoint = document.getElementById('endpoint'); const model = document.getElementById('model'); const modelOptions = document.getElementById('models'); const quickModel = document.getElementById('quickModel'); const permission = document.getElementById('permission'); const internetAccess = document.getElementById('internetAccess'); const contextWindow = document.getElementById('contextWindow'); const contextValue = document.getElementById('contextValue'); const contextMeter = document.getElementById('contextMeter'); const rateValue = document.getElementById('rateValue'); const mcpServers = document.getElementById('mcpServers'); const mcpStatus = document.getElementById('mcpStatus'); const prompt = document.getElementById('prompt'); const slashMenu = document.getElementById('slashMenu'); const attachmentInput = document.getElementById('attachmentInput'); const attachmentView = document.getElementById('attachments'); let configuration; let streamStartedAt = 0; let generatedTokens = 0; let workspaceFiles = []; let slashResults = []; let slashIndex = 0; let pendingAttachments = [];
  const persist = () => { vscode.setState(state); clearTimeout(persistTimer); persistTimer = setTimeout(() => vscode.postMessage({ type: 'saveConversations', state: { conversations: state.conversations, activeId: state.activeId } }), 250); }; const active = () => state.conversations.find((item) => item.id === state.activeId); const byId = (conversationId) => state.conversations.find((item) => item.id === conversationId); const id = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const addConversation = () => { const conversation = { id: id(), title: 'New conversation', messages: [], updatedAt: new Date().toISOString() }; state.conversations.unshift(conversation); state.activeId = conversation.id; persist(); return conversation; };
  const current = () => active() || addConversation();
  const estimateTokens = (value) => value.trim() ? Math.ceil(value.trim().length / 4) : 0;
  const formatTokens = (value) => value >= 1000 ? (value / 1000).toFixed(value >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' : String(Math.round(value));
  const configuredContextWindow = () => Math.max(512, Math.min(1000000, Number.parseInt(contextWindow.value, 10) || 8192));
  const renderTelemetry = () => { const conversation = active(); const used = (conversation ? conversation.messages.reduce((total, item) => total + estimateTokens(item.content), 0) : 0) + 400; const limit = configuredContextWindow(); const ratio = Math.min(1, used / limit); contextValue.textContent = formatTokens(used) + ' / ' + formatTokens(limit); contextMeter.style.width = (ratio * 100).toFixed(1) + '%'; contextMeter.className = ratio >= .9 ? 'critical' : ratio >= .7 ? 'warning' : ratio > 0 ? 'active' : ''; const elapsed = streamStartedAt ? (performance.now() - streamStartedAt) / 1000 : 0; rateValue.textContent = generatedTokens && elapsed > 0 ? (generatedTokens / elapsed).toFixed(1) + ' tok/s' : '-- tok/s'; };
  const deleteConversation = (conversationId) => { const conversation = byId(conversationId); if (!conversation) return; const wasActive = state.activeId === conversationId; state.conversations = state.conversations.filter((item) => item.id !== conversationId); if (wasActive) state.activeId = state.conversations[0]?.id; vscode.postMessage({ type: 'deleteConversation', conversationId }); persist(); renderHistory(); renderChat(); };
  const renderHistory = () => { history.replaceChildren(); const label = document.createElement('div'); label.className = 'history-title'; label.textContent = 'Conversations'; history.append(label); state.conversations.forEach((conversation) => { const row = document.createElement('div'); row.className = 'conversation-row'; const button = document.createElement('button'); button.className = 'conversation' + (conversation.id === state.activeId ? ' active' : ''); button.textContent = conversation.title; button.onclick = () => { state.activeId = conversation.id; persist(); renderHistory(); renderChat(); vscode.postMessage({ type: 'selectConversation', conversationId: conversation.id }); }; const remove = document.createElement('button'); remove.className = 'delete-conversation'; remove.type = 'button'; remove.textContent = 'x'; remove.title = 'Delete conversation'; remove.setAttribute('aria-label', 'Delete ' + conversation.title); remove.onclick = () => deleteConversation(conversation.id); row.append(button, remove); history.append(row); }); };
  const appendInlineMarkdown = (parent, text) => { const token = /(\`[^\`]*\`)|(\[([^\]]+)\]\(([^\s)]+)\))|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)/g; let cursor = 0; for (const match of text.matchAll(token)) { const index = match.index || 0; if (index > cursor) parent.append(document.createTextNode(text.slice(cursor, index))); if (match[1]) { const code = document.createElement('code'); code.textContent = match[1].slice(1, -1); parent.append(code); } else if (match[2]) { const link = document.createElement('a'); const href = match[4] || ''; link.textContent = match[3] || href; if (/^(https?:|mailto:)/i.test(href)) { link.href = href; link.target = '_blank'; link.rel = 'noreferrer'; } parent.append(link); } else if (match[5]) { const strong = document.createElement('strong'); strong.textContent = match[6] || ''; parent.append(strong); } else if (match[7]) { const emphasis = document.createElement('em'); emphasis.textContent = match[8] || ''; parent.append(emphasis); } cursor = index + match[0].length; } if (cursor < text.length) parent.append(document.createTextNode(text.slice(cursor))); };
  const appendHighlightedCode = (parent, code) => { const token = /(\/\/[^\n]*|#[^\n]*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(\b(?:const|let|var|function|return|if|else|for|while|class|interface|type|import|export|from|async|await|new|public|private|static|def|fn|match|use|package)\b)|(\b\d+(?:\.\d+)?\b)/g; let cursor = 0; for (const match of code.matchAll(token)) { const index = match.index || 0; if (index > cursor) parent.append(document.createTextNode(code.slice(cursor, index))); const span = document.createElement('span'); span.className = match[1] ? 'token-comment' : match[2] ? 'token-string' : match[3] ? 'token-keyword' : 'token-number'; span.textContent = match[0]; parent.append(span); cursor = index + match[0].length; } if (cursor < code.length) parent.append(document.createTextNode(code.slice(cursor))); };
  const renderMarkdown = (container, content) => { const lines = content.replace(/\r\n/g, '\n').split('\n'); for (let index = 0; index < lines.length;) { const line = lines[index]; const fence = line.match(/^\`\`\`([^\s]*)\s*$/); if (fence) { const language = fence[1] || 'text'; const code = []; index += 1; while (index < lines.length && !/^\`\`\`\s*$/.test(lines[index])) code.push(lines[index++]); if (index < lines.length) index += 1; const block = document.createElement('div'); block.className = 'code-block'; const label = document.createElement('div'); label.className = 'code-language'; label.textContent = language; const pre = document.createElement('pre'); const codeElement = document.createElement('code'); appendHighlightedCode(codeElement, code.join('\n')); pre.append(codeElement); block.append(label, pre); container.append(block); continue; } const heading = line.match(/^(#{1,4})\s+(.+)$/); if (heading) { const element = document.createElement('h' + heading[1].length); appendInlineMarkdown(element, heading[2]); container.append(element); index += 1; continue; } const list = line.match(/^[-*+]\s+(.+)$/); if (list) { const listElement = document.createElement('ul'); do { const item = document.createElement('li'); appendInlineMarkdown(item, lines[index].replace(/^[-*+]\s+/, '')); listElement.append(item); index += 1; } while (index < lines.length && /^[-*+]\s+/.test(lines[index])); container.append(listElement); continue; } const quote = line.match(/^>\s?(.*)$/); if (quote) { const blockquote = document.createElement('blockquote'); appendInlineMarkdown(blockquote, quote[1]); container.append(blockquote); index += 1; continue; } if (!line.trim()) { index += 1; continue; } const paragraph = document.createElement('p'); const paragraphLines = [line]; index += 1; while (index < lines.length && lines[index].trim() && !/^(#{1,4}\s|\`\`\`|[-*+]\s+|>\s?)/.test(lines[index])) paragraphLines.push(lines[index++]); appendInlineMarkdown(paragraph, paragraphLines.join('\n')); container.append(paragraph); } };
  const message = (role, content, attachments = []) => { const element = document.createElement('div'); element.className = 'message ' + role; const label = document.createElement('div'); label.className = 'message-header'; label.textContent = role === 'user' ? 'YOU' : 'AGENT'; const body = document.createElement('div'); if (role === 'assistant' && !content && document.body.classList.contains('streaming')) { body.className = 'thinking'; body.textContent = 'Thinking...'; } else { body.className = 'markdown'; renderMarkdown(body, content); } element.append(label, body); if (attachments.length) { const list = document.createElement('div'); list.className = 'message-attachments'; attachments.forEach((attachment) => { const item = document.createElement('div'); item.className = 'attachment'; if (attachment.kind === 'image' && attachment.data) { const image = document.createElement('img'); image.src = attachment.data; image.alt = attachment.name; item.append(image); } const name = document.createElement('span'); name.textContent = attachment.name; item.append(name); list.append(item); }); element.append(list); } return { element, body }; };
  const planView = () => { if (!activePlan) return undefined; const view = document.createElement('section'); view.className = 'plan'; const title = document.createElement('strong'); title.textContent = activePlan.title; view.append(title); activePlan.steps.forEach((step) => { const row = document.createElement('div'); row.className = 'plan-step ' + step.status; row.textContent = (step.status === 'completed' ? '[x] ' : step.status === 'in_progress' ? '[..] ' : '[ ] ') + step.content; view.append(row); }); return view; };
  const renderChat = () => { chat.replaceChildren(); const plan = planView(); if (plan) chat.append(plan); const conversation = active(); if (!conversation || !conversation.messages.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = 'Select a local model in Settings, then ask about the workspace. Use Plan for read-only investigation and Agent when you want the agent to change files or run commands.'; chat.append(empty); renderTelemetry(); return; } conversation.messages.forEach((item) => { const view = message(item.role, item.content, item.attachments || []); chat.append(view.element); }); chat.scrollTop = chat.scrollHeight; renderTelemetry(); };
  const addMessage = (role, content, attachments) => { const conversation = current(); conversation.messages.push({ role, content, ...(attachments && attachments.length ? { attachments } : {}) }); conversation.updatedAt = new Date().toISOString(); if (role === 'user' && conversation.title === 'New conversation') conversation.title = content.replace(/\s+/g, ' ').slice(0, 32) || conversation.title; persist(); renderHistory(); renderChat(); return conversation.messages.length - 1; };
  const parsedMcpServers = () => { const source = mcpServers.value.trim(); if (!source) return {}; const parsed = JSON.parse(source); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('MCP servers must be a JSON object.'); for (const [name, server] of Object.entries(parsed)) { if (!server || typeof server !== 'object' || typeof server.command !== 'string' || !server.command.trim()) throw new Error('MCP server ' + name + ' needs a command.'); } return parsed; };
  const configurationValue = () => ({ provider: provider.value, baseUrl: endpoint.value.trim(), model: model.value.trim(), ...(configuration?.credentialAccountId && configuration.provider === provider.value ? { credentialAccountId: configuration.credentialAccountId } : {}), mode: configuration ? configuration.mode : 'chat', permission: permission.value, contextWindow: configuredContextWindow(), internetAccess: internetAccess.value === 'true', mcpServers: parsedMcpServers() });
  const postConfigure = () => vscode.postMessage({ type: 'configure', configuration: configurationValue() });
  const beginStream = () => { streamStartedAt = performance.now(); generatedTokens = 0; renderTelemetry(); };
  const slashQuery = () => { const beforeCursor = prompt.value.slice(0, prompt.selectionStart || prompt.value.length); const match = beforeCursor.match(/(?:^|\s)@\/([^\s]*)$/); return match ? { start: beforeCursor.length - match[1].length - 2, query: match[1] } : undefined; };
  const fuzzyScore = (path, query) => { const target = path.toLowerCase(); const needle = query.toLowerCase(); let position = 0; let score = 0; for (const character of needle) { const next = target.indexOf(character, position); if (next === -1) return undefined; score += next - position; position = next + 1; } return score + (target.includes(needle) ? -30 : 0) + path.length / 1000; };
  const insertSlashFile = (path) => { const query = slashQuery(); if (!query) return; const cursor = prompt.selectionStart || prompt.value.length; prompt.value = prompt.value.slice(0, query.start) + '@/' + path + ' ' + prompt.value.slice(cursor); const nextCursor = query.start + path.length + 3; prompt.setSelectionRange(nextCursor, nextCursor); slashMenu.hidden = true; prompt.focus(); };
  const renderSlashMenu = () => { const query = slashQuery(); if (!query) { slashMenu.hidden = true; slashResults = []; return; } slashResults = workspaceFiles.map((path) => ({ path, score: fuzzyScore(path, query.query) })).filter((item) => item.score !== undefined).sort((left, right) => left.score - right.score || left.path.localeCompare(right.path)).slice(0, 8).map((item) => item.path); if (!slashResults.length) { slashMenu.hidden = true; return; } slashIndex = Math.min(slashIndex, slashResults.length - 1); slashMenu.replaceChildren(...slashResults.map((path, index) => { const option = document.createElement('button'); option.type = 'button'; option.className = 'slash-option' + (index === slashIndex ? ' active' : ''); option.setAttribute('role', 'option'); option.setAttribute('aria-selected', String(index === slashIndex)); option.textContent = path; option.onmousedown = (event) => { event.preventDefault(); insertSlashFile(path); }; return option; })); slashMenu.hidden = false; };
  const attachedPaths = (text) => [...new Set([...text.matchAll(/(?:^|\s)@\/([^\s]+)/g)].map((match) => match[1].replaceAll('\\', '/')).filter((path) => workspaceFiles.includes(path)))];
  const renderAttachments = () => { attachmentView.hidden = !pendingAttachments.length; attachmentView.replaceChildren(...pendingAttachments.map((attachment) => { const item = document.createElement('div'); item.className = 'attachment'; if (attachment.kind === 'image' && attachment.data) { const image = document.createElement('img'); image.src = attachment.data; image.alt = ''; item.append(image); } const name = document.createElement('span'); name.textContent = attachment.name; const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'x'; remove.title = 'Remove ' + attachment.name; remove.onclick = () => { pendingAttachments = pendingAttachments.filter((candidate) => candidate.id !== attachment.id); renderAttachments(); }; item.append(name, remove); return item; })); };
  const toAttachment = async (file) => { if (!file.name) throw new Error('The selected file has no name.'); if (file.size > 4 * 1024 * 1024) throw new Error(file.name + ' exceeds the 4 MB attachment limit.'); if (file.type.startsWith('image/')) { if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) throw new Error(file.name + ' uses an unsupported image type.'); const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Unable to read ' + file.name)); reader.onerror = () => reject(new Error('Unable to read ' + file.name)); reader.readAsDataURL(file); }); return { id: 'attachment-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8), kind: 'image', name: file.name, mediaType: file.type, data, size: file.size }; } if (!(file.type.startsWith('text/') || /\.(md|mdx|txt|json|jsonc|ya?ml|toml|ini|cfg|conf|csv|ts|tsx|js|jsx|mjs|cjs|css|html?|xml|svg|py|go|rs|java|php|rb|sh|sql)$/i.test(file.name))) throw new Error(file.name + ' is not a supported text file.'); const text = await file.text(); if (text.includes('\u0000')) throw new Error(file.name + ' appears to be binary.'); return { id: 'attachment-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8), kind: 'file', name: file.name, mediaType: file.type || 'text/plain', text: text.slice(0, 120000), size: file.size }; };
  const addFiles = async (files) => { const selected = [...files]; if (!selected.length) return; if (pendingAttachments.length + selected.length > 5) { status.textContent = 'Attach up to five files.'; return; } if (pendingAttachments.reduce((total, item) => total + item.size, 0) + selected.reduce((total, item) => total + item.size, 0) > 12 * 1024 * 1024) { status.textContent = 'Attachments exceed the 12 MB total limit.'; return; } try { pendingAttachments = [...pendingAttachments, ...await Promise.all(selected.map(toAttachment))]; renderAttachments(); } catch (error) { status.textContent = error && error.message ? error.message : String(error); } };
  const sendChat = (text) => { const conversation = current(); const history = conversation.messages.map((message) => ({ role: message.role, content: message.content, ...(message.attachments ? { attachments: message.attachments } : {}) })); const attachments = pendingAttachments; addMessage('user', text, attachments); addMessage('assistant', ''); prompt.value = ''; attachmentInput.value = ''; pendingAttachments = []; renderAttachments(); slashMenu.hidden = true; beginStream(); document.body.classList.add('streaming'); vscode.postMessage({ type: 'send', prompt: text, conversationId: conversation.id, history, attachments, attachedPaths: attachedPaths(text) }); };
  const connectGo = document.createElement('button'); connectGo.textContent = 'Truss Go'; connectGo.title = 'Connect this workspace to Truss Go on the same Wi-Fi'; connectGo.onclick = () => vscode.postMessage({ type: 'connectTrussGo' }); document.querySelector('.brand-row').prepend(connectGo);
  document.getElementById('settingsButton').onclick = () => settings.classList.toggle('open'); document.getElementById('new').onclick = () => { addConversation(); renderHistory(); renderChat(); vscode.postMessage({ type: 'newConversation' }); }; document.getElementById('help').onclick = () => sendChat('/help'); document.getElementById('manageMcp').onclick = () => vscode.postMessage({ type: 'manageMcp' });
  document.getElementById('refresh').onclick = () => { try { vscode.postMessage({ type: 'discover', configuration: configurationValue() }); } catch (error) { mcpStatus.textContent = error.message || String(error); } }; document.getElementById('apply').onclick = () => { try { mcpStatus.textContent = 'MCP connections restart when the agent runs.'; postConfigure(); } catch (error) { mcpStatus.textContent = error.message || String(error); } };
  contextWindow.oninput = renderTelemetry;
  const setMode = (mode) => { configuration = { ...(configuration || configurationValue()), mode }; document.querySelectorAll('[data-mode]').forEach((button) => button.classList.toggle('active', button.dataset.mode === mode)); postConfigure(); };
  document.querySelectorAll('[data-mode]').forEach((button) => button.onclick = () => setMode(button.dataset.mode));
  quickModel.onchange = () => { if (!quickModel.value || quickModel.value === model.value) return; model.value = quickModel.value; configuration = { ...(configuration || configurationValue()), model: quickModel.value }; postConfigure(); };
  server.onchange = () => { if (!server.value) return; const selected = JSON.parse(server.value); provider.value = selected.kind; endpoint.value = selected.baseUrl; vscode.postMessage({ type: 'discover', configuration: configurationValue() }); };
  document.getElementById('attach').onclick = () => attachmentInput.click(); attachmentInput.onchange = () => addFiles(attachmentInput.files || []); document.getElementById('composer').ondragover = (event) => event.preventDefault(); document.getElementById('composer').ondrop = (event) => { event.preventDefault(); addFiles(event.dataTransfer.files || []); };
  prompt.oninput = () => { slashIndex = 0; renderSlashMenu(); };
  prompt.onkeydown = (event) => { if (slashMenu.hidden || !slashResults.length) return; if (event.key === 'ArrowDown') { event.preventDefault(); slashIndex = (slashIndex + 1) % slashResults.length; renderSlashMenu(); } if (event.key === 'ArrowUp') { event.preventDefault(); slashIndex = (slashIndex - 1 + slashResults.length) % slashResults.length; renderSlashMenu(); } if ((event.key === 'Enter' || event.key === 'Tab') && slashResults[slashIndex]) { event.preventDefault(); insertSlashFile(slashResults[slashIndex]); } if (event.key === 'Escape') slashMenu.hidden = true; };
  document.getElementById('composer').onsubmit = (event) => { event.preventDefault(); const text = prompt.value.trim() || (pendingAttachments.length ? 'Review the attached files.' : ''); if (!text) return; sendChat(text); };
  document.getElementById('stop').onclick = () => vscode.postMessage({ type: 'stop' });
  window.addEventListener('message', (event) => { try { const message = event.data;
    if (message.type === 'conversations') { state.conversations = message.state.conversations || []; state.activeId = message.state.activeId; vscode.setState(state); renderHistory(); renderChat(); }
    if (message.type === 'state') { const next = message.state; configuration = next.configuration; provider.value = configuration.provider; endpoint.value = configuration.baseUrl; model.value = configuration.model; permission.value = configuration.permission; internetAccess.value = configuration.internetAccess ? 'true' : 'false'; contextWindow.value = configuration.contextWindow || 8192; mcpServers.value = Object.keys(configuration.mcpServers || {}).length ? JSON.stringify(configuration.mcpServers, null, 2) : ''; mcpStatus.textContent = Object.keys(configuration.mcpServers || {}).length ? Object.keys(configuration.mcpServers).length + ' MCP server(s) configured.' : 'No MCP servers configured.'; modelOptions.replaceChildren(...next.models.map((name) => { const option = document.createElement('option'); option.value = name; return option; })); const quickModels = [...new Set([configuration.model, ...next.models].filter(Boolean))]; quickModel.replaceChildren(...quickModels.map((name) => { const option = document.createElement('option'); option.value = name; option.textContent = name; return option; })); quickModel.value = configuration.model; server.replaceChildren(...[{ label: 'Custom / manual', kind: '', baseUrl: '' }, ...next.endpoints].map((item) => { const option = document.createElement('option'); option.value = item.kind ? JSON.stringify(item) : ''; option.textContent = item.label + (item.baseUrl ? ' (' + item.baseUrl + ')' : ''); return option; })); document.querySelectorAll('[data-mode]').forEach((button) => button.classList.toggle('active', button.dataset.mode === configuration.mode)); status.textContent = configuration.model ? configuration.provider + ' / ' + configuration.model : 'Choose a local model'; renderTelemetry(); }
    if (message.type === 'mcpDiagnostic') { mcpStatus.textContent = message.message; }
    if (message.type === 'workspaceFiles') { workspaceFiles = Array.isArray(message.files) ? message.files : []; }
    if (message.type === 'plan') { activePlan = message.plan; renderChat(); }
    if (message.type === 'delta') { const conversation = byId(message.conversationId) || active(); const last = conversation && conversation.messages.at(-1); if (last && last.role === 'assistant') { last.content += message.text; generatedTokens += estimateTokens(message.text); conversation.updatedAt = new Date().toISOString(); persist(); if (conversation.id === state.activeId) renderChat(); else renderTelemetry(); } }
    if (message.type === 'tool') { const item = document.createElement('div'); item.className = 'tool'; item.textContent = 'Running tool: ' + message.tool; chat.append(item); chat.scrollTop = chat.scrollHeight; }
    if (message.type === 'approval') { const item = document.createElement('div'); item.className = 'tool'; item.textContent = 'Allow ' + message.tool + ' ' + JSON.stringify(message.input) + '? '; const allow = document.createElement('button'); allow.textContent = 'Allow'; const deny = document.createElement('button'); deny.textContent = 'Deny'; allow.onclick = () => { vscode.postMessage({ type: 'toolApproval', callId: message.callId, approved: true }); item.replaceChildren(document.createTextNode('Allowed ' + message.tool)); }; deny.onclick = () => { vscode.postMessage({ type: 'toolApproval', callId: message.callId, approved: false }); item.replaceChildren(document.createTextNode('Denied ' + message.tool)); }; item.append(allow, deny); chat.append(item); chat.scrollTop = chat.scrollHeight; }
    if (message.type === 'session') { persist(); }
    if (message.type === 'runtimeReset') { persist(); }
    if (message.type === 'workspaceCommand') { current(); addMessage('user', message.command); addMessage('assistant', message.message); }
    if (message.type === 'assistantEnd') { document.body.classList.remove('streaming'); renderTelemetry(); }
    if (message.type === 'conversationReset') { renderHistory(); renderChat(); }
    if (message.type === 'error') { addMessage('assistant', 'Error: ' + message.message); document.body.classList.remove('streaming'); renderTelemetry(); }
  } catch (error) { status.textContent = 'Panel error'; const detail = document.createElement('div'); detail.className = 'tool'; detail.textContent = 'Panel error: ' + (error && error.message ? error.message : String(error)); chat.append(detail); } }); renderHistory(); renderChat(); vscode.postMessage({ type: 'ready' });
</script></body></html>`;
}
