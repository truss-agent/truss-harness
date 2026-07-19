import { execFile as execFileCallback, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { createInterface } from "node:readline";
import { detectActiveLocalModel, detectLocalContextWindow, detectLocalEndpoints, listLocalModels, type LocalEndpointKind, type LocalModelEndpoint } from "@truss-harness/provider-openai-compatible";
import { brand } from "@truss-harness/branding";
import { executeWorkspaceCommand, type ContextBlock, type WorkspacePlan } from "@truss-harness/runtime";
import * as vscode from "vscode";

const execFile = promisify(execFileCallback);

type AgentMode = "chat" | "plan" | "edit";
type PermissionMode = "ask" | "auto-read" | "auto-all";
type McpServerConfigurations = Readonly<Record<string, {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly enabled?: boolean;
  readonly readOnly?: boolean;
}>>;

interface ModelConfiguration {
  readonly provider: LocalEndpointKind;
  readonly baseUrl: string;
  readonly model: string;
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

  run(prompt: string, sessionId?: string, context?: readonly ContextBlock[]): RunHandle {
    const requestId = `vscode-${++this.requestSequence}`;
    const result = new Promise<ServiceResponse>((resolve, reject) => this.requests.set(requestId, { resolve, reject }));
    this.process.stdin.write(`${JSON.stringify({ type: "run", requestId, prompt, sessionId, context })}\n`);
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
  | { readonly type: "send"; readonly prompt: string; readonly conversationId: string; readonly history: readonly ConversationMessage[]; readonly attachedPaths?: readonly string[] }
  | { readonly type: "stop" }
  | { readonly type: "newConversation" }
  | { readonly type: "selectConversation"; readonly conversationId: string }
  | { readonly type: "deleteConversation"; readonly conversationId: string }
  | { readonly type: "saveConversations"; readonly state: StoredConversationState }
  | { readonly type: "toolApproval"; readonly callId: string; readonly approved: boolean };

interface HostState {
  readonly configuration: ModelConfiguration;
  readonly endpoints: readonly LocalModelEndpoint[];
  readonly models: readonly string[];
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
      return [{ role: item.role, content: item.content.slice(-maxStoredMessageCharacters) }];
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

function localEndpoint(configuration: ModelConfiguration): LocalModelEndpoint {
  return { id: "configured", label: "Configured endpoint", kind: configuration.provider, baseUrl: configuration.baseUrl };
}

function isConfiguration(value: unknown): value is Omit<ModelConfiguration, "mode" | "permission" | "contextWindow" | "internetAccess" | "mcpServers"> & Partial<Pick<ModelConfiguration, "mode" | "permission" | "contextWindow" | "internetAccess" | "mcpServers">> {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ModelConfiguration>;
  return (candidate.provider === "ollama" || candidate.provider === "openai-compatible")
    && typeof candidate.baseUrl === "string"
    && typeof candidate.model === "string";
}

function normalizeConfiguration(value: unknown): ModelConfiguration {
  if (!isConfiguration(value)) return defaultConfiguration;
  return {
    provider: value.provider,
    baseUrl: value.baseUrl,
    model: value.model,
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
  const startService = (): RuntimeService => {
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
      ...process.env,
      ...(configuredCommand ? {} : { ELECTRON_RUN_AS_NODE: "1" }),
      TRUSS_HARNESS_PROVIDER: configuration.provider,
      TRUSS_HARNESS_BASE_URL: configuration.baseUrl,
      TRUSS_HARNESS_MODEL: configuration.model,
      TRUSS_HARNESS_AGENT_MODE: configuration.mode,
      TRUSS_HARNESS_PERMISSION_MODE: configuration.permission,
      TRUSS_HARNESS_INTERNET_ACCESS: configuration.internetAccess ? "true" : "false",
      TRUSS_HARNESS_MCP_SERVERS: JSON.stringify(configuration.mcpServers)
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
      const detected = await detectActiveLocalModel();
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
    try { models = (await listLocalModels(localEndpoint(selectedConfiguration))).map((model) => model.name); } catch { /* Manual names remain valid for custom endpoints. */ }
    const endpoints = await detectLocalEndpoints();
    return { configuration: selectedConfiguration, endpoints, models };
  };
  const sendState = async (selectedConfiguration?: ModelConfiguration): Promise<void> => post({ type: "state", state: await state(selectedConfiguration) });
  const sendConversationState = (): void => post({ type: "conversations", state: conversations });
  const saveConversations = async (next: StoredConversationState): Promise<void> => {
    conversations = normalizeConversationState(next);
    await context.workspaceState.update("conversations", conversations);
  };

  const sendPrompt = async (prompt: string, conversationId: string, history: readonly ConversationMessage[], attachedPaths?: readonly string[]): Promise<void> => {
    if (!prompt.trim()) return;
    const command = await executeWorkspaceCommand({ workspaceRoot: workspaceRoot(), input: prompt });
    if (command.handled) {
      post({ type: "delta", conversationId, text: command.message });
      post({ type: "assistantEnd", conversationId });
      return;
    }
    const current = startService();
    sessionId = liveSessionIds.get(conversationId) ?? await current.createSession(normalizeHistory(history));
    liveSessionIds.set(conversationId, sessionId);
    post({ type: "assistantStart", conversationId });
    const run = current.run(prompt, sessionId, await workspaceFileContext(attachedPaths));
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
      const current = startService();
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
          const detectedContextWindow = await detectLocalContextWindow(localEndpoint(configuration), configuration.model).catch(() => undefined);
          if (detectedContextWindow) configuration = { ...configuration, contextWindow: detectedContextWindow };
          await context.workspaceState.update("modelConfiguration", configuration);
          disposeService();
          if (previousConfiguration.model !== configuration.model || previousConfiguration.provider !== configuration.provider || previousConfiguration.baseUrl !== configuration.baseUrl) {
            void releaseOllamaModel(previousConfiguration);
          }
          post({ type: "runtimeReset" });
          await sendState();
          break;
        case "send":
          await sendPrompt(message.prompt, message.conversationId, message.history, message.attachedPaths);
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
  context.subscriptions.push(vscode.commands.registerCommand("trussHarness.openChat", () => vscode.commands.executeCommand("workbench.view.extension.trussHarness")));
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
        const run = startService().run(prompt);
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
<section id="settings"><label>Detected server<select id="server"><option value="">Custom / manual</option></select></label><label>Provider<select id="provider"><option value="ollama">Ollama</option><option value="openai-compatible">LM Studio / compatible</option></select></label><label>Endpoint<input id="endpoint" placeholder="http://127.0.0.1:11434"></label><label>Model<input id="model" list="models" placeholder="Refresh to discover models"><datalist id="models"></datalist></label><button id="refresh">Refresh</button><button id="apply" class="primary">Use model</button></section>
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
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
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
  #composer { flex: 0 0 auto; min-width: 0; min-height: 0; position: relative; z-index: 1; display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 6px; padding: 9px 10px 6px; border-top: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); box-shadow: 0 -3px 10px color-mix(in srgb, var(--vscode-sideBar-background) 78%, transparent); } textarea { min-height: 36px; max-height: 120px; resize: vertical; padding: 7px; } #stop { display: none; } body.streaming #stop { display: inline-block; } body.streaming #send { display: none; } #agentControls { flex: 0 0 auto; min-width: 0; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 7px; align-items: center; padding: 0 10px 9px; background: var(--vscode-sideBar-background); } .quick-model { min-width: 0; display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 5px; } .quick-model span { color: var(--vscode-descriptionForeground); font-size: 10px; font-weight: 700; letter-spacing: .35px; } #quickModel { min-width: 0; height: 28px; padding: 3px 6px; }
  .message { white-space: normal; } .markdown > :first-child { margin-top: 0; } .markdown > :last-child { margin-bottom: 0; } .markdown p { margin: 0 0 8px; white-space: pre-wrap; } .markdown h1, .markdown h2, .markdown h3, .markdown h4 { margin: 12px 0 6px; font-size: 14px; line-height: 1.35; } .markdown ul { margin: 4px 0 8px; padding-left: 19px; } .markdown blockquote { margin: 7px 0; padding-left: 8px; border-left: 2px solid var(--vscode-textBlockQuote-border); color: var(--vscode-descriptionForeground); } .markdown code { padding: 1px 4px; border-radius: 3px; background: var(--vscode-textCodeBlock-background); font-family: var(--vscode-editor-font-family); font-size: .92em; } .thinking { color: var(--vscode-descriptionForeground); font-size: 12px; white-space: nowrap; animation: thinking-pulse 1.2s ease-in-out infinite; } @keyframes thinking-pulse { 0%, 100% { opacity: .45; } 50% { opacity: 1; } } .code-block { min-width: 0; max-width: 100%; overflow: hidden; margin: 9px 0; border: 1px solid var(--vscode-panel-border); border-radius: 4px; background: var(--vscode-textCodeBlock-background); } .code-language { padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border); color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family); font-size: 10px; text-transform: uppercase; } .code-block pre { min-width: 0; margin: 0; overflow: hidden; padding: 9px; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; } .code-block code { display: block; min-width: 0; padding: 0; background: transparent; font-family: var(--vscode-editor-font-family); font-size: 12px; line-height: 1.55; white-space: inherit; overflow-wrap: inherit; word-break: inherit; } .token-comment { color: var(--vscode-editorCodeLens-foreground); } .token-string { color: var(--vscode-terminal-ansiYellow); } .token-keyword { color: var(--vscode-terminal-ansiBlue); } .token-number { color: var(--vscode-terminal-ansiMagenta); } .markdown a { color: var(--vscode-textLink-foreground); } #composer { position: relative; } #slashMenu { position: absolute; z-index: 4; right: 10px; bottom: calc(100% - 2px); left: 10px; max-height: 220px; overflow: auto; padding: 4px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; background: var(--vscode-editorWidget-background); box-shadow: 0 -8px 24px #0006; } .slash-option { display: block; width: 100%; min-height: 27px; border: 0; border-radius: 3px; background: transparent; text-align: left; font-family: var(--vscode-editor-font-family); font-size: 12px; } .slash-option:hover, .slash-option.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  @media (max-width: 700px) { #settings.open { grid-template-columns: repeat(2, minmax(0, 1fr)); } } @media (max-width: 560px) { header { padding: 8px; } .brand-row { flex-wrap: wrap; } #telemetry { width: 100%; } #workspace { grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr); } #history { display: flex; gap: 4px; overflow-x: auto; overflow-y: hidden; padding: 5px; border-right: 0; border-bottom: 1px solid var(--vscode-panel-border); } .history-title { display: none; } .conversation-row { display: flex; min-width: 122px; } .conversation { width: auto; min-width: 96px; } #settings.open { grid-template-columns: 1fr; } #composer { grid-template-columns: minmax(0, 1fr) auto; } #stop, #send { grid-column: 2; } #agentControls { grid-template-columns: 1fr; } .quick-model { grid-template-columns: auto minmax(0, 1fr); } }
</style></head><body>
<header><div class="brand-row"><span class="brand">${brand.productName}</span><button id="new" title="New conversation">New</button><button id="help" title="Show local workspace commands">Help</button><button id="settingsButton" title="Model and agent settings">Settings</button></div><div id="telemetry"><div class="telemetry-context" title="Estimated from the active conversation. Local model servers do not consistently report prompt-token usage."><span class="telemetry-label">CONTEXT</span><span id="contextValue">0 / 8.2k</span><div class="meter"><span id="contextMeter"></span></div></div><div title="Estimated from streamed response text"><span class="telemetry-label">SPEED </span><span id="rateValue">-- tok/s</span></div></div></header>
<section id="settings"><label>Detected server<select id="server"><option value="">Custom / manual</option></select></label><label>Provider<select id="provider"><option value="ollama">Ollama</option><option value="openai-compatible">Compatible API</option></select></label><label>Endpoint<input id="endpoint" placeholder="http://127.0.0.1:11434"></label><label>Model<input id="model" list="models" placeholder="Refresh to discover models"><datalist id="models"></datalist></label><label>Context window<input id="contextWindow" type="number" min="512" max="1000000" step="512" value="8192"></label><label>Tool permissions<select id="permission"><option value="ask">Ask every time</option><option value="auto-read">Auto-allow read-only</option><option value="auto-all">Auto-allow all tools</option></select></label><label>Internet research<select id="internetAccess"><option value="false">Disabled</option><option value="true">Enabled</option></select></label><label class="mcp-setting">MCP servers (JSON)<textarea id="mcpServers" rows="7" spellcheck="false" placeholder='{"filesystem":{"command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","."]}}'></textarea></label><div id="mcpStatus">No MCP servers configured.</div><div class="actions"><button id="refresh">Refresh</button><button id="apply" class="primary">Apply</button></div></section>
<main id="workspace"><aside id="history"><div class="history-title">Conversations</div></aside><section id="chat"><div class="empty">Select a local model in Settings, then ask about the workspace. Use Plan for read-only investigation and Agent when you want the agent to change files or run commands.</div></section></main>
<form id="composer"><div id="slashMenu" role="listbox" hidden></div><textarea id="prompt" placeholder="Ask about this workspace. Type / to attach a file." rows="2"></textarea><button id="stop" type="button">Cancel</button><button id="send" class="primary" type="submit">Send</button></form>
<section id="agentControls" aria-label="Agent controls"><div class="segmented" aria-label="Agent mode"><button data-mode="chat">Chat</button><button data-mode="plan">Plan</button><button data-mode="edit">Agent</button></div><label class="quick-model"><span>MODEL</span><select id="quickModel" title="Switch local model"></select></label><span id="modelStatus">Choose a local model</span></section>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi(); const savedState = vscode.getState(); const state = savedState && typeof savedState === 'object' && Array.isArray(savedState.conversations) ? savedState : { conversations: [], activeId: undefined }; state.conversations = state.conversations.filter((item) => item && typeof item === 'object' && typeof item.id === 'string').map((item) => ({ ...item, title: typeof item.title === 'string' ? item.title : 'Conversation', messages: Array.isArray(item.messages) ? item.messages.filter((message) => message && (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string') : [], updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString() })); if (!state.conversations.some((item) => item.id === state.activeId)) state.activeId = state.conversations[0]?.id; vscode.setState(state); const history = document.getElementById('history'); const chat = document.getElementById('chat'); const settings = document.getElementById('settings'); const status = document.getElementById('modelStatus'); let persistTimer; let activePlan;
  const server = document.getElementById('server'); const provider = document.getElementById('provider'); const endpoint = document.getElementById('endpoint'); const model = document.getElementById('model'); const modelOptions = document.getElementById('models'); const quickModel = document.getElementById('quickModel'); const permission = document.getElementById('permission'); const internetAccess = document.getElementById('internetAccess'); const contextWindow = document.getElementById('contextWindow'); const contextValue = document.getElementById('contextValue'); const contextMeter = document.getElementById('contextMeter'); const rateValue = document.getElementById('rateValue'); const mcpServers = document.getElementById('mcpServers'); const mcpStatus = document.getElementById('mcpStatus'); const prompt = document.getElementById('prompt'); const slashMenu = document.getElementById('slashMenu'); let configuration; let streamStartedAt = 0; let generatedTokens = 0; let workspaceFiles = []; let slashResults = []; let slashIndex = 0;
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
  const message = (role, content) => { const element = document.createElement('div'); element.className = 'message ' + role; const label = document.createElement('div'); label.className = 'message-header'; label.textContent = role === 'user' ? 'YOU' : 'AGENT'; const body = document.createElement('div'); if (role === 'assistant' && !content && document.body.classList.contains('streaming')) { body.className = 'thinking'; body.textContent = 'Thinking...'; } else { body.className = 'markdown'; renderMarkdown(body, content); } element.append(label, body); return { element, body }; };
  const planView = () => { if (!activePlan) return undefined; const view = document.createElement('section'); view.className = 'plan'; const title = document.createElement('strong'); title.textContent = activePlan.title; view.append(title); activePlan.steps.forEach((step) => { const row = document.createElement('div'); row.className = 'plan-step ' + step.status; row.textContent = (step.status === 'completed' ? '[x] ' : step.status === 'in_progress' ? '[..] ' : '[ ] ') + step.content; view.append(row); }); return view; };
  const renderChat = () => { chat.replaceChildren(); const plan = planView(); if (plan) chat.append(plan); const conversation = active(); if (!conversation || !conversation.messages.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = 'Select a local model in Settings, then ask about the workspace. Use Plan for read-only investigation and Agent when you want the agent to change files or run commands.'; chat.append(empty); renderTelemetry(); return; } conversation.messages.forEach((item) => { const view = message(item.role, item.content); chat.append(view.element); }); chat.scrollTop = chat.scrollHeight; renderTelemetry(); };
  const addMessage = (role, content) => { const conversation = current(); conversation.messages.push({ role, content }); conversation.updatedAt = new Date().toISOString(); if (role === 'user' && conversation.title === 'New conversation') conversation.title = content.replace(/\s+/g, ' ').slice(0, 32) || conversation.title; persist(); renderHistory(); renderChat(); return conversation.messages.length - 1; };
  const parsedMcpServers = () => { const source = mcpServers.value.trim(); if (!source) return {}; const parsed = JSON.parse(source); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('MCP servers must be a JSON object.'); for (const [name, server] of Object.entries(parsed)) { if (!server || typeof server !== 'object' || typeof server.command !== 'string' || !server.command.trim()) throw new Error('MCP server ' + name + ' needs a command.'); } return parsed; };
  const configurationValue = () => ({ provider: provider.value, baseUrl: endpoint.value.trim(), model: model.value.trim(), mode: configuration ? configuration.mode : 'chat', permission: permission.value, contextWindow: configuredContextWindow(), internetAccess: internetAccess.value === 'true', mcpServers: parsedMcpServers() });
  const postConfigure = () => vscode.postMessage({ type: 'configure', configuration: configurationValue() });
  const beginStream = () => { streamStartedAt = performance.now(); generatedTokens = 0; renderTelemetry(); };
  const slashQuery = () => { const beforeCursor = prompt.value.slice(0, prompt.selectionStart || prompt.value.length); const match = beforeCursor.match(/(?:^|\s)\/([^\s]*)$/); return match ? { start: beforeCursor.length - match[1].length - 1, query: match[1] } : undefined; };
  const fuzzyScore = (path, query) => { const target = path.toLowerCase(); const needle = query.toLowerCase(); let position = 0; let score = 0; for (const character of needle) { const next = target.indexOf(character, position); if (next === -1) return undefined; score += next - position; position = next + 1; } return score + (target.includes(needle) ? -30 : 0) + path.length / 1000; };
  const insertSlashFile = (path) => { const query = slashQuery(); if (!query) return; const cursor = prompt.selectionStart || prompt.value.length; prompt.value = prompt.value.slice(0, query.start) + '/' + path + ' ' + prompt.value.slice(cursor); const nextCursor = query.start + path.length + 2; prompt.setSelectionRange(nextCursor, nextCursor); slashMenu.hidden = true; prompt.focus(); };
  const renderSlashMenu = () => { const query = slashQuery(); if (!query) { slashMenu.hidden = true; slashResults = []; return; } slashResults = workspaceFiles.map((path) => ({ path, score: fuzzyScore(path, query.query) })).filter((item) => item.score !== undefined).sort((left, right) => left.score - right.score || left.path.localeCompare(right.path)).slice(0, 8).map((item) => item.path); if (!slashResults.length) { slashMenu.hidden = true; return; } slashIndex = Math.min(slashIndex, slashResults.length - 1); slashMenu.replaceChildren(...slashResults.map((path, index) => { const option = document.createElement('button'); option.type = 'button'; option.className = 'slash-option' + (index === slashIndex ? ' active' : ''); option.setAttribute('role', 'option'); option.setAttribute('aria-selected', String(index === slashIndex)); option.textContent = path; option.onmousedown = (event) => { event.preventDefault(); insertSlashFile(path); }; return option; })); slashMenu.hidden = false; };
  const attachedPaths = (text) => [...new Set([...text.matchAll(/(?:^|\s)\/([^\s]+)/g)].map((match) => match[1].replaceAll('\\', '/')).filter((path) => workspaceFiles.includes(path)))];
  const sendChat = (text) => { const conversation = current(); const history = conversation.messages.map((message) => ({ role: message.role, content: message.content })); addMessage('user', text); addMessage('assistant', ''); prompt.value = ''; slashMenu.hidden = true; beginStream(); document.body.classList.add('streaming'); vscode.postMessage({ type: 'send', prompt: text, conversationId: conversation.id, history, attachedPaths: attachedPaths(text) }); };
  document.getElementById('settingsButton').onclick = () => settings.classList.toggle('open'); document.getElementById('new').onclick = () => { addConversation(); renderHistory(); renderChat(); vscode.postMessage({ type: 'newConversation' }); }; document.getElementById('help').onclick = () => sendChat('/help');
  document.getElementById('refresh').onclick = () => { try { vscode.postMessage({ type: 'discover', configuration: configurationValue() }); } catch (error) { mcpStatus.textContent = error.message || String(error); } }; document.getElementById('apply').onclick = () => { try { mcpStatus.textContent = 'MCP connections restart when the agent runs.'; postConfigure(); } catch (error) { mcpStatus.textContent = error.message || String(error); } };
  contextWindow.oninput = renderTelemetry;
  const setMode = (mode) => { configuration = { ...(configuration || configurationValue()), mode }; document.querySelectorAll('[data-mode]').forEach((button) => button.classList.toggle('active', button.dataset.mode === mode)); postConfigure(); };
  document.querySelectorAll('[data-mode]').forEach((button) => button.onclick = () => setMode(button.dataset.mode));
  quickModel.onchange = () => { if (!quickModel.value || quickModel.value === model.value) return; model.value = quickModel.value; configuration = { ...(configuration || configurationValue()), model: quickModel.value }; postConfigure(); };
  server.onchange = () => { if (!server.value) return; const selected = JSON.parse(server.value); provider.value = selected.kind; endpoint.value = selected.baseUrl; vscode.postMessage({ type: 'discover', configuration: configurationValue() }); };
  prompt.oninput = () => { slashIndex = 0; renderSlashMenu(); };
  prompt.onkeydown = (event) => { if (slashMenu.hidden || !slashResults.length) return; if (event.key === 'ArrowDown') { event.preventDefault(); slashIndex = (slashIndex + 1) % slashResults.length; renderSlashMenu(); } if (event.key === 'ArrowUp') { event.preventDefault(); slashIndex = (slashIndex - 1 + slashResults.length) % slashResults.length; renderSlashMenu(); } if ((event.key === 'Enter' || event.key === 'Tab') && slashResults[slashIndex]) { event.preventDefault(); insertSlashFile(slashResults[slashIndex]); } if (event.key === 'Escape') slashMenu.hidden = true; };
  document.getElementById('composer').onsubmit = (event) => { event.preventDefault(); const text = prompt.value.trim(); if (!text) return; sendChat(text); };
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
