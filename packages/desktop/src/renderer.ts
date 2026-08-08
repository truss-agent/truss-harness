import type {
  ChatAttachment,
  ProviderAccount,
  WorkspacePlan,
} from "@truss-harness/runtime";
import type {
  McpServerStatus,
  McpStdioServerConfiguration,
} from "@truss-harness/mcp";
import hljs from "highlight.js/lib/common";
import {
  desktopThemeNames,
  type DesktopAgentsSnapshot,
  type DesktopConfiguration,
  type DesktopConversation,
  type DesktopCredentialStorage,
  type DesktopEndpoint,
  type DesktopEvent,
  type DesktopFile,
  type DesktopGitGraph,
  type DesktopGitStatus,
  type DesktopMessage,
  type DesktopModelInfo,
  type DesktopProvider,
  type DesktopState,
  type DesktopThemePalette,
  type DesktopThemePreference,
  type DesktopTokenUsage,
  type DesktopToolActivity,
  type DesktopWorkspaceUiState,
} from "./shared.js";
import { scheduleConversationNavigation } from "./conversation-navigation.js";

declare global {
  interface Window {
    trussDesktop: import("./shared.js").DesktopBridge;
  }
}

interface EmbeddedBrowserView extends HTMLElement {
  src: string;
  loadURL(url: string): Promise<void>;
  getURL(): string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  openDevTools(): void;
}

const defaultConfiguration: DesktopConfiguration = {
  provider: "ollama",
  baseUrl: "http://127.0.0.1:11434",
  model: "",
  mode: "chat",
  permission: "ask",
  contextWindow: 8_192,
  internetAccess: false,
  autocomplete: { enabled: false },
  formatOnSave: false,
  mcpServers: {},
};

const element = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;
const toolActivityPanel = element<HTMLDivElement>("toolActivityPanel");
const fileTree = element<HTMLDivElement>("fileTree");
const fileSearch = element<HTMLInputElement>("fileSearch");
const clearFileSearch = element<HTMLButtonElement>("clearFileSearch");
const fileContextMenu = element<HTMLDivElement>("fileContextMenu");
const conversations = element<HTMLDivElement>("conversationList");
const workbench = document.querySelector<HTMLElement>(
  ".workbench",
) as HTMLElement;
const sidebar = document.querySelector<HTMLElement>(".sidebar") as HTMLElement;
const editorArea = document.querySelector<HTMLElement>(
  ".editor-area",
) as HTMLElement;
const filesSection = document.querySelector<HTMLElement>(
  ".files-section",
) as HTMLElement;
const historySection = document.querySelector<HTMLElement>(
  ".history-section",
) as HTMLElement;
const centerSurface = element<HTMLElement>("centerSurface");
const editorContent = document.querySelector<HTMLElement>(
  ".editor-content",
) as HTMLElement;
const terminal = document.querySelector<HTMLElement>(
  ".terminal",
) as HTMLElement;
const gitPanel = element<HTMLElement>("gitPanel");
const gitBody = element<HTMLDivElement>("gitBody");
const gitBranch = element<HTMLSpanElement>("gitBranch");
const gitCounts = element<HTMLSpanElement>("gitCounts");
const gitGraph = element<HTMLDivElement>("gitGraph");
const gitFiles = element<HTMLDivElement>("gitFiles");
const pullGit = element<HTMLButtonElement>("pullGit");
const pushGit = element<HTMLButtonElement>("pushGit");
const commitMessage = element<HTMLInputElement>("commitMessage");
const commitButton = element<HTMLButtonElement>("commitButton");
const generateCommitMessage = element<HTMLButtonElement>(
  "generateCommitMessage",
);
const editor = element<HTMLElement>("editor");
const formatFileButton = element<HTMLButtonElement>("formatFileButton");
const editorTabsElement = element<HTMLDivElement>("editorTabs");
const editorTitle = element<HTMLSpanElement>("editorTitle");
const fileDiffToggle = element<HTMLButtonElement>("fileDiffToggle");
const browserPanel = element<HTMLElement>("browserPanel");
const agentsPanel = element<HTMLElement>("agentsPanel");
const browserView = element<EmbeddedBrowserView>("browserView");
const browserUrl = element<HTMLInputElement>("browserUrl");
const browserBack = element<HTMLButtonElement>("browserBack");
const browserForward = element<HTMLButtonElement>("browserForward");
const browserReload = element<HTMLButtonElement>("browserReload");
const browserExternal = element<HTMLButtonElement>("browserExternal");
const terminalOutput = element<HTMLPreElement>("terminalOutput");
const terminalPrompt = element<HTMLDivElement>("terminalPrompt");
const chatMessages = element<HTMLDivElement>("chatMessages");
const chatArea = document.querySelector<HTMLElement>(".chat-area") as HTMLElement;
const toggleChat = element<HTMLButtonElement>("toggleChat");
const chatSplitter = element<HTMLDivElement>("chatSplitter");
const toggleChatDock = element<HTMLButtonElement>("toggleChatDock");
const planPanel = element<HTMLElement>("planPanel");
const chatInput = element<HTMLTextAreaElement>("chatInput");
const attachmentInput = element<HTMLInputElement>("attachmentInput");
const addAttachment = element<HTMLButtonElement>("addAttachment");
const attachmentList = element<HTMLDivElement>("attachmentList");
const sendChatButton = element<HTMLButtonElement>("sendChat");
const cancelChatButton = element<HTMLButtonElement>("cancelChat");
const slashMenu = element<HTMLDivElement>("slashMenu");
const chatStatus = element<HTMLSpanElement>("chatStatus");
const runtimeStatus = element<HTMLSpanElement>("runtimeStatus");
const statusDot = element<HTMLSpanElement>("statusDot");
const connectTrussGo = element<HTMLButtonElement>("connectTrussGo");
const trussGoDialog = element<HTMLDialogElement>("trussGoDialog");
const trussGoQr = element<HTMLImageElement>("trussGoQr");
const trussGoWorkspace = element<HTMLElement>("trussGoWorkspace");
const fileEntryDialog = element<HTMLDialogElement>("fileEntryDialog");
const fileEntryForm = element<HTMLFormElement>("fileEntryForm");
const fileEntryTitle = element<HTMLElement>("fileEntryTitle");
const fileEntryDescription = element<HTMLElement>("fileEntryDescription");
const fileEntryInput = element<HTMLInputElement>("fileEntryInput");
const confirmFileEntry = element<HTMLButtonElement>("confirmFileEntry");
const confirmDialog = element<HTMLDialogElement>("confirmDialog");
const confirmTitle = element<HTMLElement>("confirmTitle");
const confirmMessage = element<HTMLElement>("confirmMessage");
const acceptConfirm = element<HTMLButtonElement>("acceptConfirm");
const cancelConfirm = element<HTMLButtonElement>("cancelConfirm");
const closeConfirm = element<HTMLButtonElement>("closeConfirm");
const quickModel = element<HTMLSelectElement>("quickModel");
const contextMeter = element<HTMLSpanElement>("contextMeter");
const modelMeter = element<HTMLSpanElement>("modelMeter");
const usageMeter = element<HTMLSpanElement>("usageMeter");
// Keep older packaged HTML usable when only the renderer bundle has been refreshed.
const rateMeter = document.getElementById(
  "rateMeter",
) as HTMLSpanElement | null;
const settingsPanel = element<HTMLElement>("settingsPanel");
const settingsPanelHome = document.createComment("settings-panel-home");
settingsPanel.before(settingsPanelHome);
const endpointSelect = element<HTMLSelectElement>("endpointSelect");
const providerSelect = element<HTMLSelectElement>("providerSelect");
const byokProviderSelect = element<HTMLSelectElement>("byokProviderSelect");
const baseUrlInput = element<HTMLInputElement>("baseUrlInput");
const modelInput = element<HTMLInputElement>("modelInput");
const byokBaseUrl = element<HTMLInputElement>("byokBaseUrl");
const byokModelSelect = element<HTMLSelectElement>("byokModelSelect");
const byokModelInput = element<HTMLInputElement>("byokModelInput");
const providerAccountSelect = element<HTMLSelectElement>(
  "providerAccountSelect",
);
const providerAccountLabel = element<HTMLInputElement>("providerAccountLabel");
const newProviderAccount = element<HTMLButtonElement>("newProviderAccount");
const saveProviderAccount = element<HTMLButtonElement>("saveProviderAccount");
const deleteProviderAccount = element<HTMLButtonElement>(
  "deleteProviderAccount",
);
const discoverByokModels = element<HTMLButtonElement>("discoverByokModels");
const apiKeyInput = element<HTMLInputElement>("apiKeyInput");
const clearApiKey = element<HTMLButtonElement>("clearApiKey");
const testProviderConnection = element<HTMLButtonElement>(
  "testProviderConnection",
);
const providerConnectionResult = element<HTMLParagraphElement>(
  "providerConnectionResult",
);
const credentialStorageStatus = element<HTMLParagraphElement>(
  "credentialStorageStatus",
);
const modelOptions = element<HTMLDataListElement>("modelOptions");
const contextInput = element<HTMLInputElement>("contextInput");
const permissionSelect = element<HTMLSelectElement>("permissionSelect");
const internetAccessInput = element<HTMLInputElement>("internetAccessInput");
const autocompleteEnabled = element<HTMLInputElement>("autocompleteEnabled");
const autocompleteModel = element<HTMLInputElement>("autocompleteModel");
const formatOnSave = element<HTMLInputElement>("formatOnSave");
const mcpServersInput = element<HTMLTextAreaElement>("mcpServersInput");
const mcpStatus = element<HTMLDivElement>("mcpStatus");
const mcpServerList = element<HTMLDivElement>("mcpServerList");
const mcpServerEditor = element<HTMLElement>("mcpServerEditor");
const mcpEditorTitle = element<HTMLElement>("mcpEditorTitle");
const mcpNameInput = element<HTMLInputElement>("mcpNameInput");
const mcpCommandInput = element<HTMLInputElement>("mcpCommandInput");
const mcpArgsInput = element<HTMLTextAreaElement>("mcpArgsInput");
const mcpCwdInput = element<HTMLInputElement>("mcpCwdInput");
const mcpEnabledInput = element<HTMLInputElement>("mcpEnabledInput");
const mcpReadOnlyInput = element<HTMLInputElement>("mcpReadOnlyInput");
const checkUpdatesOnLaunch = element<HTMLInputElement>("checkUpdatesOnLaunch");
const autoDownloadUpdates = element<HTMLInputElement>("autoDownloadUpdates");
const themeSelect = element<HTMLSelectElement>("themeSelect");
const customThemeSetting = element<HTMLElement>("customThemeSetting");
const customThemeInput = element<HTMLTextAreaElement>("customThemeInput");
const customThemeHelp = element<HTMLDivElement>("customThemeHelp");
const customThemeActions = element<HTMLDivElement>("customThemeActions");
const saveCustomTheme = element<HTMLButtonElement>("saveCustomTheme");
const updateStatus = element<HTMLSpanElement>("updateStatus");
const checkUpdates = element<HTMLButtonElement>("checkUpdates");
const downloadUpdate = element<HTMLButtonElement>("downloadUpdate");
const installUpdate = element<HTMLButtonElement>("installUpdate");
const toast = element<HTMLDivElement>("toast");

let desktopState: DesktopState = {
  workspaceRoot: "",
  zoomFactor: 1,
  updates: { checkOnLaunch: true, autoDownload: false },
  theme: { name: "default" },
  conversations: [],
};
let credentialStorage: DesktopCredentialStorage = "secure";
let mcpDraft: Record<string, McpStdioServerConfiguration> = {};
let editingMcpName: string | undefined;
const testedMcpStatuses = new Map<string, McpServerStatus>();
let endpoints: readonly DesktopEndpoint[] = [];
let models: readonly DesktopModelInfo[] = [];
let byokModels: readonly DesktopModelInfo[] = [];
let files: readonly DesktopFile[] = [];
let fileSearchQuery = "";
type FileContextTarget = {
  readonly kind: "root" | "directory" | "file";
  readonly path: string;
};
let fileContextTarget: FileContextTarget | undefined;
let copiedWorkspaceFile: string | undefined;
let resolveFileEntry: ((value: string | undefined) => void) | undefined;
let resolveConfirmation: ((value: boolean) => void) | undefined;
let activeFile: string | undefined;
let showingDiff = false;
let inlineCompletion = "";
let completionTimer: number | undefined;
let completionRequest = 0;
let syntaxTimer: number | undefined;
let lastZoomWheelAt = 0;
type EditorTabMode = "file" | "diff" | "settings";
type EditorTabState = "loading" | "ready" | "error";
interface EditorTab {
  readonly path: string;
  mode: EditorTabMode;
  state: EditorTabState;
  content: string;
  dirty: boolean;
  scrollTop: number;
  revision: number;
}
type ToolActivity = DesktopToolActivity;
const openEditorTabs: EditorTab[] = [];
const settingsEditorPath = "__truss_settings__";
const toolActivityByConversation = new Map<string, ToolActivity[]>();
const toolActivityExpandedByConversation = new Map<string, boolean>();
let busy = false;
let persistTimer: number | undefined;
let workspaceUiPersistTimer: number | undefined;
let slashResults: readonly DesktopFile[] = [];
let slashIndex = 0;
const expandedDirectories = new Set<string>();
const loadedDirectoryContents = new Set<string>();
let gitStatus: DesktopGitStatus = {
  available: false,
  ahead: 0,
  behind: 0,
  files: [],
};
let gitGraphData: DesktopGitGraph = { available: false, commits: [] };
let gitCollapsed = false;
let gitPanelHeight = 220;
let activePlan: WorkspacePlan | undefined;
let streamStartedAt = 0;
let streamedTextCharacters = 0;
let agentActivity = "Ready";
let runningConversationId: string | undefined;
let chatCollapsed = false;
let chatDocked = false;
let centerView: "editor" | "preview" | "agents" | "chat" = "editor";
let agentsSnapshot: DesktopAgentsSnapshot = { profiles: [], runs: [] };
let selectedAgentRunId: string | undefined;
let pendingAttachments: ChatAttachment[] = [];
type SettingsTab = "local" | "byok" | "other";
let activeSettingsTab: SettingsTab = "local";
let modelSettingsTab: "local" | "byok" = "local";
let selectedProviderAccountId: string | undefined;
let creatingProviderAccount = false;
const maxAttachmentCount = 5;
const maxAttachmentBytes = 4 * 1024 * 1024;
const maxAttachmentTotalBytes = 12 * 1024 * 1024;
const maxFileTextCharacters = 120_000;
const longPasteAttachmentThreshold = 12_000;

function configuration(): DesktopConfiguration {
  return desktopState.configuration ?? defaultConfiguration;
}

function knownModel(modelId = configuration().model): DesktopModelInfo | undefined {
  return [...models, ...byokModels].find((model) => model.id === modelId);
}

function selectedModelContextWindow(modelId: string): number | undefined {
  return knownModel(modelId)?.contextWindow;
}

function formatUsd(value: number): string {
  if (value === 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}

function modelLabel(model: DesktopModelInfo): string {
  const prices =
    model.inputCostPerMillion !== undefined &&
    model.outputCostPerMillion !== undefined
      ? ` · ${formatUsd(model.inputCostPerMillion)}/${formatUsd(model.outputCostPerMillion)} per 1M`
      : "";
  const context = model.contextWindow
    ? ` · ${formatTokens(model.contextWindow)} context`
    : "";
  return `${model.id}${prices}${context}`;
}

function usageCost(usage: Pick<DesktopTokenUsage, "inputTokens" | "outputTokens">): number | undefined {
  const model = knownModel();
  if (!model) return undefined;
  const inputCost = model.inputCostPerMillion;
  const outputCost = model.outputCostPerMillion;
  if (inputCost === undefined && outputCost === undefined) return undefined;
  return (
    (usage.inputTokens / 1_000_000) * (inputCost ?? 0) +
    (usage.outputTokens / 1_000_000) * (outputCost ?? 0)
  );
}

function addUsage(
  previous: DesktopTokenUsage | undefined,
  next: Pick<DesktopTokenUsage, "inputTokens" | "outputTokens" | "totalTokens">,
): DesktopTokenUsage {
  const usage = {
    inputTokens: (previous?.inputTokens ?? 0) + next.inputTokens,
    outputTokens: (previous?.outputTokens ?? 0) + next.outputTokens,
    totalTokens: (previous?.totalTokens ?? 0) + next.totalTokens,
  };
  return { ...usage, estimatedCostUsd: usageCost(usage) };
}

function estimatedConversationUsage(
  conversation: DesktopConversation,
): DesktopTokenUsage {
  const inputTokens = conversation.messages
    .slice(0, -1)
    .reduce((total, message) => total + Math.ceil(message.content.length / 4), 0);
  const outputTokens = conversation.messages.at(-1)?.role === "assistant"
    ? Math.ceil((conversation.messages.at(-1)?.content.length ?? 0) / 4)
    : 0;
  const usage = {
    inputTokens: Math.max(1, inputTokens),
    outputTokens,
    totalTokens: Math.max(1, inputTokens) + outputTokens,
  };
  return { ...usage, estimated: true, estimatedCostUsd: usageCost(usage) };
}

const customThemeProperties: Readonly<
  Record<keyof DesktopThemePalette, string>
> = {
  background: "--desktop-background",
  surface: "--desktop-surface",
  panel: "--desktop-panel",
  border: "--desktop-border",
  text: "--desktop-text",
  muted: "--desktop-muted",
  accent: "--desktop-accent",
  accentText: "--desktop-accent-text",
  warning: "--desktop-warning",
  error: "--desktop-error",
};

function isThemeColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function parseCustomTheme(): DesktopThemePalette {
  const source = customThemeInput.value.trim();
  if (!source) return {};
  const parsed = JSON.parse(source) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Custom theme must be a JSON object.");
  const palette: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed)) {
    if (!(name in customThemeProperties))
      throw new Error(`Unknown custom theme token: ${name}.`);
    if (!isThemeColor(value))
      throw new Error(`${name} must be a #RRGGBB color.`);
    palette[name] = value;
  }
  return palette as DesktopThemePalette;
}

function applyTheme(theme: DesktopThemePreference): void {
  const root = document.documentElement;
  for (const property of Object.values(customThemeProperties))
    root.style.removeProperty(property);
  if (theme.name === "default") {
    delete root.dataset.desktopTheme;
    return;
  }
  root.dataset.desktopTheme = theme.name;
  if (theme.name === "custom") {
    for (const [name, value] of Object.entries(theme.custom ?? {})) {
      const property = customThemeProperties[name as keyof DesktopThemePalette];
      if (property && isThemeColor(value))
        root.style.setProperty(property, value);
    }
  }
}

function renderCustomThemeControls(): void {
  const custom = themeSelect.value === "custom";
  customThemeSetting.hidden = !custom;
  customThemeHelp.hidden = !custom;
  customThemeActions.hidden = !custom;
}

async function saveTheme(theme: DesktopThemePreference): Promise<void> {
  applyTheme(theme);
  desktopState = await window.trussDesktop.configureTheme(theme);
  notify(
    `${theme.name === "custom" ? "Custom" : theme.name[0].toUpperCase() + theme.name.slice(1)} theme saved.`,
  );
}

function isLocalProvider(
  provider: DesktopProvider,
): provider is "ollama" | "openai-compatible" {
  return provider === "ollama" || provider === "openai-compatible";
}

function byokBaseUrlForSelectedProvider(): string {
  return byokProviderSelect.selectedOptions[0]?.dataset.baseUrl ?? "";
}

function providerAccountsFor(
  provider: DesktopProvider,
): readonly ProviderAccount[] {
  return (desktopState.providerAccounts ?? []).filter(
    (account) => account.providerId === provider,
  );
}

function renderProviderAccounts(preferredId?: string): void {
  const provider = byokProviderSelect.value as DesktopProvider;
  const accounts = providerAccountsFor(provider);
  const currentId = configuration().credentialAccountId;
  const nextId =
    preferredId && accounts.some((account) => account.id === preferredId)
      ? preferredId
      : currentId && accounts.some((account) => account.id === currentId)
        ? currentId
        : accounts[0]?.id;
  selectedProviderAccountId = nextId;
  providerAccountSelect.replaceChildren(
    ...(accounts.length
      ? accounts.map((account) => {
          const option = document.createElement("option");
          option.value = account.id;
          option.textContent = `${account.label} (${account.status})`;
          return option;
        })
      : [
          (() => {
            const option = document.createElement("option");
            option.value = "";
            option.textContent = "No saved account yet";
            return option;
          })(),
        ]),
  );
  providerAccountSelect.value = nextId ?? "";
  const selected = accounts.find((account) => account.id === nextId);
  providerAccountLabel.value = creatingProviderAccount
    ? ""
    : (selected?.label ?? "");
  deleteProviderAccount.disabled = !selected || creatingProviderAccount;
  saveProviderAccount.textContent = creatingProviderAccount
    ? "Create account"
    : "Save account";
}

function renderByokModels(preferredModel?: string): void {
  const current = preferredModel ?? byokModelInput.value.trim();
  byokModelSelect.replaceChildren(
    ...(byokModels.length
      ? byokModels.map((model) => {
          const option = document.createElement("option");
          option.value = model.id;
          option.textContent = modelLabel(model);
          return option;
        })
      : [
          (() => {
            const option = document.createElement("option");
            option.value = "";
            option.textContent = "Refresh models to load choices";
            return option;
          })(),
        ]),
  );
  byokModelSelect.value = byokModels.some((model) => model.id === current)
    ? current
    : "";
}

async function discoverByokModelList(): Promise<void> {
  const provider = byokProviderSelect.value as DesktopProvider;
  discoverByokModels.disabled = true;
  try {
    const result = await window.trussDesktop.discoverModels(
      {
        provider,
        baseUrl: byokBaseUrlForSelectedProvider(),
        credentialAccountId: selectedProviderAccountId,
      },
      apiKeyInput.value.trim() || undefined,
    );
    byokModels = result.models;
    renderByokModels();
    if (!byokModels.length) throw new Error("The provider returned no models.");
    notify(`Loaded ${byokModels.length} ${provider} model${byokModels.length === 1 ? "" : "s"}.`);
  } catch (error) {
    byokModels = [];
    renderByokModels();
    notify(error instanceof Error ? error.message : String(error));
  } finally {
    discoverByokModels.disabled = false;
  }
}

function selectedSettingsProvider(): DesktopProvider {
  return modelSettingsTab === "byok"
    ? (byokProviderSelect.value as DesktopProvider)
    : (providerSelect.value as DesktopProvider);
}

function setSettingsTab(tab: SettingsTab): void {
  activeSettingsTab = tab;
  if (tab !== "other") modelSettingsTab = tab;
  if (tab === "byok") {
    byokBaseUrl.value = byokBaseUrlForSelectedProvider();
    renderProviderAccounts(selectedProviderAccountId);
  }
  (document.getElementById("settingsPanelLocal") as HTMLElement).hidden =
    tab !== "local";
  (document.getElementById("settingsPanelByok") as HTMLElement).hidden =
    tab !== "byok";
  (document.getElementById("settingsPanelOther") as HTMLElement).hidden =
    tab !== "other";
  document
    .querySelectorAll<HTMLButtonElement>("[data-settings-tab]")
    .forEach((button) => {
      const selected = button.dataset.settingsTab === tab;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
}

function activeConversation(): DesktopConversation | undefined {
  return desktopState.conversations.find(
    (conversation) => conversation.id === desktopState.activeConversationId,
  );
}

function conversationById(
  id: string | undefined,
): DesktopConversation | undefined {
  return id
    ? desktopState.conversations.find((conversation) => conversation.id === id)
    : undefined;
}

function createId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function tokenEstimate(messages: readonly DesktopMessage[]): number {
  return messages.reduce(
    (total, message) => total + Math.ceil(message.content.trim().length / 4),
    400,
  );
}

function isDirectWorkspaceChangeRequest(prompt: string): boolean {
  const action =
    "(?:add|change|create|delete|edit|fix|implement|modify|overhaul|refactor|remove|rename|replace|rewrite|rework|update|write)";
  const directRequest = new RegExp(
    `^\\s*(?:(?:please|can you|could you|would you)\\s+)?${action}\\b|^\\s*(?:i am going to|i'm going to|we need to|let's)\\s+${action}\\b`,
    "i",
  );
  const errorReport =
    /\b(?:error|exception|stack trace|uncaught|referenceerror|typeerror|syntaxerror|not working|doesn['’]t work|broken|failed)\b/i;
  return directRequest.test(prompt) || errorReport.test(prompt);
}

function formatTokens(value: number): string {
  return value >= 1_000
    ? `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k`
    : String(Math.round(value));
}

function notify(message: string): void {
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 2_800);
}

function normalizedPreviewUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Enter a preview URL.");
  const normalized = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  const url = new URL(normalized);
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("Preview URLs must use HTTP or HTTPS.");
  return url.toString();
}

function setCenterView(next: "editor" | "preview" | "agents" | "chat"): void {
  if (next === "chat" && !chatDocked) {
    setChatDocked(true);
    return;
  }
  centerView = next;
  editor.hidden = next !== "editor";
  browserPanel.hidden = next !== "preview";
  agentsPanel.hidden = next !== "agents";
  chatArea.hidden = chatDocked && next !== "chat";
  document
    .querySelectorAll<HTMLButtonElement>("[data-center-view]")
    .forEach((button) =>
      button.classList.toggle("active", button.dataset.centerView === next),
    );
  if (next === "agents") renderAgents();
}

const agentCloudProviders = [
  ["openai", "OpenAI", "https://api.openai.com/v1"],
  ["anthropic", "Anthropic", "https://api.anthropic.com/v1"],
  ["openrouter", "OpenRouter", "https://openrouter.ai/api/v1"],
  ["groq", "Groq", "https://api.groq.com/openai/v1"],
  ["together", "Together AI", "https://api.together.ai/v1"],
  ["gemini", "Google Gemini", "https://generativelanguage.googleapis.com/v1beta/openai"],
  ["xai", "xAI", "https://api.x.ai/v1"],
  ["mistral", "Mistral AI", "https://api.mistral.ai/v1"],
  ["deepseek", "DeepSeek", "https://api.deepseek.com"],
  ["perplexity", "Perplexity", "https://api.perplexity.ai"],
  ["fireworks", "Fireworks AI", "https://api.fireworks.ai/inference/v1"],
  ["nvidia-nim", "NVIDIA NIM", "https://integrate.api.nvidia.com/v1"],
  ["xiaomi-mimo", "Xiaomi MiMo", "https://api.xiaomimimo.com/v1"],
  ["ollama-cloud", "Ollama Cloud", "https://ollama.com"],
] as const;

function agentProviderOptions(selected: string): HTMLOptionElement[] {
  const providers = [
    ["ollama", "Ollama"],
    ["openai-compatible", "OpenAI-compatible"],
    ["llama-cpp", "llama.cpp server"],
    ...agentCloudProviders.map(([id, label]) => [id, label] as const),
  ];
  return providers.map(([id, label]) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = label;
    option.selected = id === selected;
    return option;
  });
}

function agentProviderDefaultEndpoint(provider: string): string | undefined {
  if (provider === "ollama") return "http://127.0.0.1:11434";
  if (provider === "openai-compatible" || provider === "llama-cpp")
    return provider === "llama-cpp"
      ? "http://127.0.0.1:8080/v1"
      : "http://127.0.0.1:1234/v1";
  return agentCloudProviders.find(([id]) => id === provider)?.[2];
}

function applyAgentsSnapshot(snapshot: DesktopAgentsSnapshot): void {
  agentsSnapshot = snapshot;
  if (centerView === "agents") renderAgents();
}

function renderAgents(): void {
  agentsPanel.replaceChildren();
  const heading = document.createElement("div");
  heading.className = "agents-heading";
  const title = document.createElement("div");
  title.innerHTML =
    "<strong>Agents</strong><span>Run independent local or BYOK agents in this workspace.</span>";
  const stopAll = document.createElement("button");
  stopAll.type = "button";
  stopAll.textContent = "Stop all";
  stopAll.disabled = !agentsSnapshot.runs.some((run) =>
    ["queued", "running", "waiting_for_approval"].includes(run.state),
  );
  stopAll.onclick = () =>
    void window.trussDesktop
      .stopAllAgents()
      .then(applyAgentsSnapshot)
      .catch((error) =>
        notify(error instanceof Error ? error.message : String(error)),
      );
  heading.append(title, stopAll);

  const create = document.createElement("form");
  create.className = "agent-create";
  const name = document.createElement("input");
  name.placeholder = "Agent name";
  name.value = "New agent";
  const provider = document.createElement("select");
  provider.append(
    ...agentProviderOptions(desktopState.configuration?.provider ?? "ollama"),
  );
  const endpoint = document.createElement("input");
  endpoint.placeholder = "Endpoint URL";
  endpoint.value =
    desktopState.configuration?.baseUrl ??
    agentProviderDefaultEndpoint(provider.value) ??
    "";
  const model = document.createElement("select");
  model.title = "Model";
  const account = document.createElement("select");
  account.title = "Provider account";
  const syncAccounts = (): void => {
    const providerId = provider.value as DesktopProvider;
    const local = ["ollama", "openai-compatible", "llama-cpp"].includes(
      provider.value,
    );
    const accounts = providerAccountsFor(providerId);
    account.replaceChildren(
      ...(accounts.length
        ? accounts.map((candidate) => {
            const option = document.createElement("option");
            option.value = candidate.id;
            option.textContent = `Account: ${candidate.label}`;
            return option;
          })
        : [
            (() => {
              const option = document.createElement("option");
              option.value = providerId;
              option.textContent = "Default provider credential";
              return option;
            })(),
          ]),
    );
    account.hidden = local;
  };
  const renderAgentModels = (available: readonly DesktopModelInfo[]): void => {
    const selected = model.value || desktopState.configuration?.model || "";
    const values = [
      ...(selected && !available.some((candidate) => candidate.id === selected)
        ? [{ id: selected }]
        : []),
      ...available,
    ];
    model.replaceChildren(
      ...(values.length
        ? values.map((value) => {
            const option = document.createElement("option");
            option.value = value.id;
            option.textContent = modelLabel(value);
            return option;
          })
        : [
            (() => {
              const option = document.createElement("option");
              option.value = "";
              option.textContent = "No models available";
              return option;
            })(),
          ]),
    );
    model.value = selected;
  };
  const loadAgentModels = async (): Promise<void> => {
    const providerId = provider.value;
    const discoveryProvider =
      providerId === "llama-cpp" ? "openai-compatible" : providerId;
    try {
      const result = await window.trussDesktop.discoverModels({
        provider: discoveryProvider as DesktopProvider,
        baseUrl: endpoint.value,
        ...(["ollama", "openai-compatible", "llama-cpp"].includes(providerId)
          ? {}
          : { credentialAccountId: account.value || undefined }),
      });
      renderAgentModels(result.models);
    } catch {
      // Keep the active model usable when a provider does not expose discovery.
      renderAgentModels([]);
    }
  };
  let previousProvider = provider.value;
  provider.onchange = () => {
    const previousDefault = agentProviderDefaultEndpoint(previousProvider);
    const nextDefault = agentProviderDefaultEndpoint(provider.value);
    if (!endpoint.value.trim() || endpoint.value === previousDefault)
      endpoint.value = nextDefault ?? "";
    previousProvider = provider.value;
    syncAccounts();
    void loadAgentModels();
  };
  account.onchange = () => void loadAgentModels();
  endpoint.onchange = () => void loadAgentModels();
  syncAccounts();
  renderAgentModels([]);
  void loadAgentModels();
  const mode = document.createElement("select");
  for (const value of ["chat", "plan", "edit"] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent =
      value === "edit" ? "Agent" : value[0].toUpperCase() + value.slice(1);
    option.selected = value === "plan";
    mode.append(option);
  }
  const add = document.createElement("button");
  add.className = "primary";
  add.textContent = "Create agent";
  create.append(name, provider, endpoint, model, account, mode, add);
  create.onsubmit = (event) => {
    event.preventDefault();
    const providerId = provider.value;
    void window.trussDesktop
      .createAgent({
        displayName: name.value,
        provider: {
          providerId,
          endpointUrl: endpoint.value,
          modelId: model.value,
          ...(["ollama", "openai-compatible", "llama-cpp"].includes(providerId)
            ? {}
            : { credentialRef: account.value || providerId }),
        },
        mode: mode.value as "chat" | "plan" | "edit",
        approvalPolicy: "ask",
        internetAccess: false,
      })
      .then(applyAgentsSnapshot)
      .catch((error) =>
        notify(error instanceof Error ? error.message : String(error)),
      );
  };

  const cards = document.createElement("div");
  cards.className = "agent-cards";
  for (const profile of agentsSnapshot.profiles) {
    const profileRuns = agentsSnapshot.runs.filter(
      (candidate) => candidate.agentId === profile.id,
    );
    const activeRun = profileRuns.find((candidate) =>
      ["queued", "running", "waiting_for_approval"].includes(candidate.state),
    );
    const latestRun = activeRun ?? profileRuns.at(-1);
    const card = document.createElement("section");
    card.className = "agent-card";
    const details = document.createElement("div");
    details.className = "agent-card-title";
    const label = document.createElement("strong");
    label.textContent = profile.displayName;
    const status = document.createElement("span");
    status.textContent = latestRun?.state.replaceAll("_", " ") ?? "idle";
    details.append(label, status);
    const binding = document.createElement("p");
    const accountLabel = profile.provider.credentialRef
      ? desktopState.providerAccounts?.find(
          (candidate) => candidate.id === profile.provider.credentialRef,
        )?.label
      : undefined;
    binding.textContent = `${profile.provider.providerId} · ${profile.provider.modelId} · ${profile.mode}${accountLabel ? ` · ${accountLabel}` : ""}${profile.provider.endpointUrl ? ` · ${profile.provider.endpointUrl}` : ""}`;
    const prompt = document.createElement("textarea");
    prompt.rows = 2;
    prompt.placeholder = "Give this agent a focused task";
    prompt.disabled = Boolean(activeRun);
    const actions = document.createElement("div");
    actions.className = "agent-card-actions";
    const start = document.createElement("button");
    start.className = "primary";
    start.textContent = activeRun ? "Running" : "Start";
    const updateStartAvailability = (): void => {
      start.disabled = Boolean(activeRun) || !prompt.value.trim();
    };
    prompt.addEventListener("input", updateStartAvailability);
    updateStartAvailability();
    start.onclick = () => {
      const task = prompt.value.trim();
      if (!task) {
        notify("Enter a focused task before starting this agent.");
        prompt.focus();
        return;
      }
      void window.trussDesktop
        .startAgent(profile.id, task)
        .then(applyAgentsSnapshot)
        .catch((error) =>
          notify(error instanceof Error ? error.message : String(error)),
        );
    };
    const stop = document.createElement("button");
    stop.textContent = "Stop";
    stop.disabled = !activeRun;
    stop.onclick = () =>
      activeRun &&
      void window.trussDesktop
        .stopAgent(activeRun.id)
        .then(applyAgentsSnapshot)
        .catch((error) =>
          notify(error instanceof Error ? error.message : String(error)),
        );
    const remove = document.createElement("button");
    remove.textContent = "Delete";
    remove.disabled = Boolean(activeRun);
    remove.onclick = () =>
      void window.trussDesktop
        .deleteAgent(profile.id)
        .then(applyAgentsSnapshot)
        .catch((error) =>
          notify(error instanceof Error ? error.message : String(error)),
        );
    if (latestRun) {
      const detail = document.createElement("button");
      detail.textContent = "Details";
      detail.onclick = () => {
        selectedAgentRunId = latestRun.id;
        renderAgents();
      };
      actions.append(detail);
    }
    actions.append(start, stop, remove);
    if (activeRun?.state === "waiting_for_approval" && activeRun.activeTool) {
      const approval = document.createElement("div");
      approval.className = "agent-approval";
      approval.textContent = `Approve ${activeRun.activeTool.name}?`;
      for (const [labelText, approved] of [
        ["Allow", true],
        ["Deny", false],
      ] as const) {
        const button = document.createElement("button");
        button.textContent = labelText;
        button.onclick = () =>
          void window.trussDesktop
            .resolveAgentApproval(
              activeRun.id,
              activeRun.activeTool?.callId ?? "",
              approved,
            )
            .then(applyAgentsSnapshot);
        approval.append(button);
      }
      card.append(approval);
    }
    const progress = document.createElement("small");
    progress.textContent =
      latestRun?.latestProgress ??
      latestRun?.error?.message ??
      "Ready for a task.";
    card.append(details, binding, prompt, actions, progress);
    cards.append(card);
  }
  if (!agentsSnapshot.profiles.length) {
    const empty = document.createElement("p");
    empty.className = "agents-empty";
    empty.textContent =
      "Create an agent to run a focused task with its own provider, model, and mode.";
    cards.append(empty);
  }
  const selectedRun = selectedAgentRunId
    ? agentsSnapshot.runs.find((run) => run.id === selectedAgentRunId)
    : undefined;
  if (!selectedRun) selectedAgentRunId = undefined;
  const detailPanel = document.createElement("section");
  detailPanel.className = "agent-run-detail";
  detailPanel.hidden = !selectedRun;
  if (selectedRun) {
    const profile = agentsSnapshot.profiles.find(
      (candidate) => candidate.id === selectedRun.agentId,
    );
    const detailHeading = document.createElement("div");
    detailHeading.className = "agent-run-detail-heading";
    const detailTitle = document.createElement("div");
    const titleText = document.createElement("strong");
    titleText.textContent = `${profile?.displayName ?? "Agent"} run`;
    const state = document.createElement("span");
    state.textContent = selectedRun.state.replaceAll("_", " ");
    detailTitle.append(titleText, state);
    const close = document.createElement("button");
    close.textContent = "Close details";
    close.onclick = () => {
      selectedAgentRunId = undefined;
      renderAgents();
    };
    detailHeading.append(detailTitle, close);
    detailPanel.append(detailHeading);
    const summary = document.createElement("p");
    summary.textContent =
      selectedRun.latestProgress ??
      selectedRun.error?.message ??
      "No additional progress has been reported for this run.";
    detailPanel.append(summary);
    if (selectedRun.output) {
      const outputHeading = document.createElement("strong");
      outputHeading.textContent = "Response";
      const output = document.createElement("pre");
      output.className = "agent-run-output";
      output.textContent = selectedRun.output;
      detailPanel.append(outputHeading, output);
    }
    if (selectedRun.activeTool) {
      const tool = document.createElement("p");
      tool.textContent = `Current tool: ${selectedRun.activeTool.name}`;
      detailPanel.append(tool);
    }
    if (selectedRun.changedFiles.length) {
      const changedHeading = document.createElement("strong");
      changedHeading.textContent = "Verified changed files";
      const files = document.createElement("div");
      files.className = "agent-changed-files";
      for (const path of selectedRun.changedFiles) {
        const file = document.createElement("button");
        file.textContent = path;
        file.title = `Open ${path}`;
        file.onclick = () =>
          void openFile(path, false)
            .then(() => setCenterView("editor"))
            .catch((error) =>
              notify(error instanceof Error ? error.message : String(error)),
            );
        files.append(file);
      }
      detailPanel.append(changedHeading, files);
    }
  }
  agentsPanel.append(heading, create, cards, detailPanel);
}

function updateBrowserNavigation(): void {
  try {
    browserBack.disabled = !browserView.canGoBack();
    browserForward.disabled = !browserView.canGoForward();
    const current = browserView.getURL();
    if (current && current !== "about:blank") browserUrl.value = current;
  } catch {
    browserBack.disabled = true;
    browserForward.disabled = true;
  }
}

function navigatePreview(value: string): void {
  let url: string;
  try {
    url = normalizedPreviewUrl(value);
  } catch (error) {
    notify(error instanceof Error ? error.message : String(error));
    return;
  }
  browserUrl.value = url;
  setCenterView("preview");
  // Setting src follows the webview's regular navigation lifecycle. loadURL()
  // rejects when it supersedes the initial about:blank navigation on Electron.
  browserView.src = url;
}

function saveConversations(): void {
  window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    void window.trussDesktop.saveConversations(
      desktopState.conversations,
      desktopState.activeConversationId,
    );
  }, 220);
}

function workspaceUiState(): DesktopWorkspaceUiState {
  preserveEditorScroll();
  return {
    expandedDirectories: [...expandedDirectories],
    openEditors: openEditorTabs.flatMap((tab) =>
      tab.mode === "settings"
        ? []
        : [{ path: tab.path, mode: tab.mode, scrollTop: tab.scrollTop }],
    ),
    activeFile: activeWorkspaceFilePath(),
    fileTreeScrollTop: fileTree.scrollTop,
  };
}

function saveWorkspaceUiState(): void {
  window.clearTimeout(workspaceUiPersistTimer);
  workspaceUiPersistTimer = window.setTimeout(() => {
    const state = workspaceUiState();
    desktopState = { ...desktopState, workspaceUiState: state };
    void window.trussDesktop.saveWorkspaceUiState(state);
  }, 180);
}

function setBusy(next: boolean): void {
  if (next && !busy) {
    // Generation latency and tool time are not part of output throughput. Start
    // the timer only on the first text chunk and estimate from all characters.
    streamStartedAt = 0;
    streamedTextCharacters = 0;
    agentActivity = "Thinking";
  }
  if (!next) agentActivity = "Ready";
  busy = next;
  sendChatButton.hidden = next;
  cancelChatButton.hidden = !next;
  chatStatus.textContent = agentActivity;
  statusDot.className = `status-dot ${next ? "busy" : desktopState.configuration?.model ? "ready" : ""}`;
  renderRuntime();
}

function setChatCollapsed(next: boolean): void {
  chatCollapsed = next;
  chatArea.classList.toggle("chat-collapsed", next);
  workbench.classList.toggle("chat-collapsed", next && !chatDocked);
  toggleChat.textContent = next ? "Restore" : "Minimize";
  toggleChat.title = next ? "Restore agent panel" : "Minimize agent panel";
  toggleChat.setAttribute("aria-expanded", String(!next));
}

function setChatDocked(next: boolean): void {
  if (chatDocked === next) {
    if (next) setCenterView("chat");
    return;
  }
  chatDocked = next;
  setChatCollapsed(false);
  if (next) {
    centerSurface.append(chatArea);
    chatSplitter.hidden = true;
    chatArea.classList.add("chat-docked");
    toggleChatDock.textContent = "Side";
    toggleChatDock.title = "Return agent panel to the side";
    toggleChatDock.setAttribute("aria-pressed", "true");
    workbench.classList.add("chat-docked");
    setCenterView("chat");
    return;
  }
  chatSplitter.after(chatArea);
  chatSplitter.hidden = false;
  chatArea.classList.remove("chat-docked");
  toggleChatDock.textContent = "Full size";
  toggleChatDock.title = "Move agent panel into the editor area";
  toggleChatDock.setAttribute("aria-pressed", "false");
  workbench.classList.remove("chat-docked");
  setCenterView("editor");
}

function cancelActiveRunForNavigation(): void {
  if (!busy) return;
  const running = conversationById(runningConversationId);
  if (running) {
    updateConversation(running.id, (current) => ({
      ...current,
      lastRun: {
        status: "failed",
        modifiedFiles: [],
        completedAt: new Date().toISOString(),
      },
    }));
  }
  runningConversationId = undefined;
  setBusy(false);
  void window.trussDesktop.stopChat();
}

function renderRuntime(): void {
  const config = desktopState.configuration;
  runtimeStatus.textContent = config?.model
    ? `${config.provider} / ${config.model}`
    : "No model selected";
  statusDot.className = `status-dot ${busy ? "busy" : config?.model ? "ready" : ""}`;
  document
    .querySelectorAll<HTMLButtonElement>("[data-mode]")
    .forEach((button) =>
      button.classList.toggle(
        "active",
        button.dataset.mode === configuration().mode,
      ),
    );
  const values = [
    ...new Set(
      [config?.model, ...models.map((model) => model.id)].filter(
        (value): value is string => Boolean(value),
      ),
    ),
  ];
  quickModel.replaceChildren(
    ...values.map((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = modelLabel(knownModel(value) ?? { id: value });
      return option;
    }),
  );
  quickModel.value = config?.model ?? "";
  const used = tokenEstimate(activeConversation()?.messages ?? []);
  const selectedModel = knownModel();
  const currentConfiguration = configuration();
  const contextLimit =
    selectedModel?.contextWindow ??
    (isLocalProvider(currentConfiguration.provider)
      ? currentConfiguration.contextWindow
      : currentConfiguration.modelContextWindow);
  contextMeter.textContent = contextLimit
    ? `Context ${formatTokens(used)} / ${formatTokens(contextLimit)} est.`
    : `Context ${formatTokens(used)} / unknown`;
  const selectedPrice = selectedModel
    ? selectedModel.inputCostPerMillion !== undefined &&
      selectedModel.outputCostPerMillion !== undefined
      ? `${formatUsd(selectedModel.inputCostPerMillion)} in / ${formatUsd(selectedModel.outputCostPerMillion)} out per 1M`
      : "Pricing unavailable"
    : "Model metadata unavailable";
  modelMeter.textContent = selectedPrice;
  modelMeter.title = selectedModel?.contextWindow
    ? `${modelLabel(selectedModel)}${selectedModel.supportsTools === false ? " · tool calling not advertised" : ""}`
    : "Refresh models to load pricing and context metadata.";
  const runUsage = activeConversation()?.lastRun?.usage;
  usageMeter.textContent = runUsage
    ? `Usage ${formatTokens(runUsage.inputTokens)} in / ${formatTokens(runUsage.outputTokens)} out${runUsage.estimated ? " est." : ""}${runUsage.estimatedCostUsd !== undefined ? ` · ${formatUsd(runUsage.estimatedCostUsd)}` : ""}`
    : busy
      ? "Usage pending"
      : "Usage --";
  chatStatus.textContent = busy ? agentActivity : "Ready";
  const elapsed = streamStartedAt
    ? (performance.now() - streamStartedAt) / 1_000
    : 0;
  const estimatedTokens = streamedTextCharacters / 4;
  if (rateMeter) {
    rateMeter.textContent =
      estimatedTokens && elapsed > 0
        ? `Output ${(estimatedTokens / elapsed).toFixed(1)} est. tok/s`
        : busy
          ? `Working · ${agentActivity}`
          : "Output -- tok/s";
  }
}

function statusLabel(file: DesktopGitStatus["files"][number]): string {
  const status = `${file.indexStatus}${file.workTreeStatus}`;
  if (status === "??") return "NEW";
  if (status.includes("A")) return "ADD";
  if (status.includes("D")) return "DEL";
  if (status.includes("R")) return "REN";
  if (status.includes("M")) return "MOD";
  return status.trim() || "CHG";
}

const gitGraphColors = [
  "#f28b30",
  "#4f9cf9",
  "#e03b8b",
  "#f1bd22",
  "#9b6ade",
  "#54d7b0",
];

function graphRefLabel(ref: string): string {
  return ref
    .replace(/^HEAD -> /, "")
    .replace(/^refs\/heads\//, "")
    .replace(/^refs\/remotes\//, "");
}

function graphDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function appendSvgLine(
  svg: SVGSVGElement,
  attributes: Record<string, string>,
): void {
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  for (const [name, value] of Object.entries(attributes))
    line.setAttribute(name, value);
  svg.append(line);
}

function appendSvgPath(
  svg: SVGSVGElement,
  attributes: Record<string, string>,
): void {
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  for (const [name, value] of Object.entries(attributes))
    path.setAttribute(name, value);
  svg.append(path);
}

function renderGitGraph(): void {
  gitGraph.replaceChildren();
  if (!gitGraphData.available) {
    gitGraph.textContent = "Git history unavailable.";
    return;
  }
  if (!gitGraphData.commits.length) {
    gitGraph.textContent = "No commits yet.";
    return;
  }

  const lanes: string[] = [];
  const rows = gitGraphData.commits.map((commit) => {
    let laneIndex = lanes.indexOf(commit.hash);
    if (laneIndex < 0) {
      laneIndex = 0;
      lanes.unshift(commit.hash);
    }
    const before = [...lanes];
    lanes.splice(laneIndex, 1, ...commit.parents);
    const nextLanes = lanes.filter(
      (hash, index) => lanes.indexOf(hash) === index,
    );
    lanes.splice(0, lanes.length, ...nextLanes);
    return { commit, laneIndex, before, after: [...lanes] };
  });
  const laneCount = Math.max(
    1,
    ...rows.flatMap((row) => [row.before.length, row.after.length]),
  );
  const graphWidth = Math.max(42, laneCount * 16 + 18);

  gitGraph.replaceChildren(
    ...rows.map(({ commit, laneIndex, before, after }) => {
      const row = document.createElement("div");
      row.className = "git-graph-row";
      const visual = document.createElement("div");
      visual.className = "git-graph-visual";
      visual.style.width = `${graphWidth}px`;
      const svg = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg",
      );
      svg.setAttribute("viewBox", `0 0 ${graphWidth} 36`);
      svg.setAttribute("aria-hidden", "true");
      const xFor = (index: number) => 9 + index * 16;
      before.forEach((_hash, index) => {
        const color = gitGraphColors[index % gitGraphColors.length];
        appendSvgLine(svg, {
          x1: String(xFor(index)),
          y1: "0",
          x2: String(xFor(index)),
          y2: "36",
          stroke: color,
          "stroke-width": "2",
        });
      });
      const currentX = xFor(laneIndex);
      commit.parents.forEach((parent) => {
        const parentIndex = after.indexOf(parent);
        if (parentIndex < 0) return;
        const parentX = xFor(parentIndex);
        if (parentX === currentX) return;
        appendSvgPath(svg, {
          d: `M ${currentX} 18 C ${currentX} 27, ${parentX} 27, ${parentX} 36`,
          fill: "none",
          stroke: gitGraphColors[parentIndex % gitGraphColors.length],
          "stroke-width": "2",
        });
      });
      const node = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "circle",
      );
      node.setAttribute("cx", String(currentX));
      node.setAttribute("cy", "18");
      node.setAttribute("r", "5");
      node.setAttribute("fill", gitGraphColors[laneIndex % gitGraphColors.length]);
      node.setAttribute("stroke", "#11161a");
      node.setAttribute("stroke-width", "2");
      svg.append(node);
      visual.append(svg);

      const details = document.createElement("div");
      details.className = "git-graph-commit";
      const heading = document.createElement("div");
      heading.className = "git-graph-commit-heading";
      const subject = document.createElement("span");
      subject.className = "git-graph-subject";
      subject.textContent = commit.subject;
      subject.title = `${commit.subject}\n${commit.hash}`;
      heading.append(subject);
      for (const ref of commit.refs) {
        const badge = document.createElement("span");
        badge.className = `git-ref-badge ${ref.includes("remotes/") ? "remote" : ""}`;
        badge.textContent = graphRefLabel(ref);
        badge.title = ref;
        heading.append(badge);
      }
      const metadata = document.createElement("span");
      metadata.className = "git-graph-meta";
      metadata.textContent = `${commit.author} · ${graphDate(commit.authoredAt)} · ${commit.shortHash}`;
      details.append(heading, metadata);
      row.append(visual, details);
      return row;
    }),
  );
}

function sidebarTracks(): {
  readonly git: number;
  readonly files: number;
  readonly history: number;
} {
  return {
    git: gitPanel.getBoundingClientRect().height,
    files: filesSection.getBoundingClientRect().height,
    history: historySection.getBoundingClientRect().height,
  };
}

function applySidebarTracks(git: number, files: number, history: number): void {
  sidebar.style.setProperty("--git-height", `${git}px`);
  sidebar.style.setProperty("--files-height", `${files}px`);
  sidebar.style.setProperty("--history-height", `${history}px`);
}

function resetSidebarTracks(): void {
  const splitterHeight =
    element<HTMLDivElement>("gitSplitter").getBoundingClientRect().height +
    element<HTMLDivElement>("historySplitter").getBoundingClientRect().height;
  const availableHeight =
    sidebar.getBoundingClientRect().height - splitterHeight;
  if (gitCollapsed) {
    const sharedHeight = Math.max(110, Math.floor((availableHeight - 38) / 2));
    applySidebarTracks(38, sharedHeight, sharedHeight);
    return;
  }
  const sharedHeight = Math.max(110, Math.floor(availableHeight / 3));
  gitPanelHeight = sharedHeight;
  applySidebarTracks(sharedHeight, sharedHeight, sharedHeight);
}

function setGitCollapsed(collapsed: boolean): void {
  if (gitCollapsed === collapsed) return;
  const tracks = sidebarTracks();
  const releasedHeight = Math.max(0, tracks.git - 38);
  if (collapsed) gitPanelHeight = tracks.git;
  gitCollapsed = collapsed;
  renderGit();
  if (collapsed) {
    const filesGain = Math.floor(releasedHeight / 2);
    applySidebarTracks(
      38,
      tracks.files + filesGain,
      tracks.history + releasedHeight - filesGain,
    );
    return;
  }
  const restoredGit = Math.min(
    gitPanelHeight,
    Math.max(38, tracks.files + tracks.history - 220 + 38),
  );
  const neededHeight = Math.max(0, restoredGit - 38);
  const availableFiles = Math.max(0, tracks.files - 110);
  const availableHistory = Math.max(0, tracks.history - 110);
  const availableTotal = availableFiles + availableHistory;
  const fromFiles = Math.min(
    availableFiles,
    Math.round(neededHeight * (availableFiles / Math.max(1, availableTotal))),
  );
  const fromHistory = Math.min(availableHistory, neededHeight - fromFiles);
  applySidebarTracks(
    restoredGit,
    tracks.files - fromFiles,
    tracks.history - fromHistory,
  );
}

let observedSidebarHeight = 0;
new ResizeObserver(() => {
  const sidebarHeight = Math.floor(sidebar.getBoundingClientRect().height);
  if (!sidebarHeight || sidebarHeight === observedSidebarHeight) return;
  observedSidebarHeight = sidebarHeight;
  const splitterHeight =
    element<HTMLDivElement>("gitSplitter").getBoundingClientRect().height +
    element<HTMLDivElement>("historySplitter").getBoundingClientRect().height;
  const availableHeight = Math.max(220, sidebarHeight - splitterHeight);
  const tracks = sidebarTracks();
  if (gitCollapsed) {
    const remainingHeight = Math.max(220, availableHeight - 38);
    const proportion =
      tracks.files / Math.max(1, tracks.files + tracks.history);
    const filesHeight = Math.round(remainingHeight * proportion);
    applySidebarTracks(38, filesHeight, remainingHeight - filesHeight);
    return;
  }
  const proportion =
    tracks.git / Math.max(1, tracks.git + tracks.files + tracks.history);
  const gitHeight = Math.max(38, Math.round(availableHeight * proportion));
  const remainingHeight = Math.max(220, availableHeight - gitHeight);
  const filesProportion =
    tracks.files / Math.max(1, tracks.files + tracks.history);
  const filesHeight = Math.round(remainingHeight * filesProportion);
  applySidebarTracks(gitHeight, filesHeight, remainingHeight - filesHeight);
}).observe(sidebar);

function renderGit(): void {
  gitPanel.classList.toggle("collapsed", gitCollapsed);
  gitBody.hidden = gitCollapsed;
  const toggle = element<HTMLButtonElement>("toggleGit");
  toggle.textContent = gitCollapsed ? "Show" : "Hide";
  toggle.title = gitCollapsed ? "Expand Git panel" : "Collapse Git panel";
  toggle.setAttribute("aria-expanded", String(!gitCollapsed));
  if (!gitStatus.available) {
    gitBranch.textContent = "Git unavailable";
    gitCounts.textContent = "";
    renderGitGraph();
    gitFiles.replaceChildren();
    commitButton.disabled = true;
    commitButton.title = "Git is unavailable in this workspace";
    pullGit.disabled = true;
    pushGit.disabled = true;
    return;
  }
  gitBranch.textContent = gitStatus.branch || "No branch yet";
  const staged = gitStatus.files.filter(
    (file) => file.indexStatus !== " " && file.indexStatus !== "?",
  );
  gitCounts.textContent = [
    gitStatus.ahead ? `up ${gitStatus.ahead}` : "",
    gitStatus.behind ? `down ${gitStatus.behind}` : "",
    `${gitStatus.files.length} changed`,
    staged.length ? `${staged.length} staged` : "commit will stage changes",
    gitStatus.pushRemote ? `remote ${gitStatus.pushRemote}` : "no push remote",
  ]
    .filter(Boolean)
    .join(" | ");
  renderGitGraph();
  commitButton.disabled = gitStatus.files.length === 0;
  commitButton.title = staged.length
    ? "Commit staged changes"
    : "Commit all changed files; staging happens automatically";
  pushGit.disabled = !gitStatus.pushRemote;
  pushGit.title = gitStatus.pushRemote
    ? `Push to ${gitStatus.pushRemote}`
    : "No push remote configured. Add one with: git remote add origin <url>";
  const stageAll = element<HTMLButtonElement>("stageAll");
  stageAll.textContent = staged.length ? "Unstage all" : "Stage all";
  stageAll.title = staged.length
    ? "Unstage every staged file"
    : "Stage all changed files";
  stageAll.disabled = gitStatus.files.length === 0;
  element<HTMLButtonElement>("discardAll").disabled =
    gitStatus.files.length === 0;
  gitFiles.replaceChildren(
    ...gitStatus.files.map((file) => {
      const row = document.createElement("div");
      row.className = "git-file-row";
      const status = document.createElement("span");
      status.className = "git-file-status";
      status.textContent = statusLabel(file);
      const open = document.createElement("button");
      open.className = "git-file-name";
      open.textContent = file.path;
      open.title = file.path;
      open.onclick = () => void openFile(file.path, false);
      const actions = document.createElement("div");
      actions.className = "git-row-actions";
      row.append(status, open, actions);
      if (file.indexStatus !== " " && file.indexStatus !== "?") {
        const unstage = document.createElement("button");
        unstage.className = "git-row-action";
        unstage.textContent = "-";
        unstage.title = `Unstage ${file.path}`;
        unstage.setAttribute("aria-label", `Unstage ${file.path}`);
        unstage.onclick = () =>
          void runGitAction("unstage", () =>
            window.trussDesktop.gitUnstage([file.path]),
          );
        actions.append(unstage);
      }
      if (file.workTreeStatus !== " " || file.indexStatus === "?") {
        const stage = document.createElement("button");
        stage.className = "git-row-action";
        stage.textContent = "+";
        stage.title = `Stage ${file.path}`;
        stage.setAttribute("aria-label", `Stage ${file.path}`);
        stage.onclick = () =>
          void runGitAction("stage", () =>
            window.trussDesktop.gitStage([file.path]),
          );
        actions.append(stage);
      }
      const discard = document.createElement("button");
      discard.className = "git-row-action danger";
      discard.textContent = "x";
      discard.title = `Discard all uncommitted changes in ${file.path}`;
      discard.setAttribute("aria-label", `Discard ${file.path}`);
      discard.onclick = () =>
        void requestConfirmation({
          title: "Discard file changes",
          message: `Discard all uncommitted changes in ${file.path}? This cannot be undone.`,
          confirmLabel: "Discard",
          danger: true,
        }).then((confirmed) => {
          if (confirmed)
            void runGitAction("discard", () =>
              window.trussDesktop.gitDiscard([file.path]),
            );
        });
      actions.append(discard);
      return row;
    }),
  );
}

async function refreshGit(): Promise<void> {
  [gitStatus, gitGraphData] = await Promise.all([
    window.trussDesktop.gitStatus(),
    window.trussDesktop.gitGraph(),
  ]);
  renderGit();
  renderTerminalPrompt();
}

function renderTerminalPrompt(): void {
  const workspaceParts = desktopState.workspaceRoot
    .replaceAll("\\", "/")
    .split("/")
    .filter(Boolean);
  const path =
    workspaceParts.length > 3
      ? `…/${workspaceParts.slice(-3).join("/")}`
      : workspaceParts.join("/") || "No workspace";
  const branch = gitStatus.available
    ? gitStatus.branch || "detached"
    : "no git";
  const changed = gitStatus.files.length;
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());
  const segments: ReadonlyArray<readonly [string, string]> = [
    ["terminal-prompt-app", "Truss"],
    ["terminal-prompt-path", path],
    [
      "terminal-prompt-git",
      `${branch}${changed ? ` • ${changed} changed` : ""}`,
    ],
    ["terminal-prompt-time", time],
  ];
  terminalPrompt.replaceChildren(
    ...segments.map(([className, text]) => {
      const segment = document.createElement("span");
      segment.className = `terminal-prompt-segment ${className}`;
      segment.textContent = text;
      return segment;
    }),
  );
}

async function runGitAction(
  action: string,
  run: () => Promise<string>,
): Promise<void> {
  try {
    const result = await run();
    appendTerminal(`\n[git ${action}]\n${result}\n`);
    notify(`Git ${action} complete.`);
    await Promise.all([refreshGit(), loadFiles()]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendTerminal(`\n[git ${action} failed]\n${message}\n`);
    notify(`Git ${action} failed: ${message}`);
  }
}

function renderFiles(): void {
  const scrollTop = fileTree.scrollTop;
  fileTree.replaceChildren();
  window.requestAnimationFrame(() => {
    fileTree.scrollTop = scrollTop;
  });
  if (!files.length) {
    const empty = document.createElement("div");
    empty.className = "empty-chat";
    empty.textContent = "No files loaded.";
    fileTree.append(empty);
    return;
  }
  const query = fileSearchQuery.trim();
  clearFileSearch.hidden = !query;
  if (query) {
    const matches = files
      .filter((file) => file.type === "file")
      .flatMap((file) => {
        const score = fuzzyScore(file.path, query);
        return score === undefined ? [] : [{ file, score }];
      })
      .sort(
        (left, right) =>
          left.score - right.score ||
          left.file.path.localeCompare(right.file.path),
      );
    if (!matches.length) {
      const empty = document.createElement("div");
      empty.className = "empty-chat";
      empty.textContent = `No files match “${query}”.`;
      fileTree.append(empty);
      return;
    }
    for (const { file } of matches) {
      const row = document.createElement("div");
      row.className = "tree-row file filtered";
      const button = document.createElement("button");
      appendFileLabel(button, file.path, file.path);
      button.title = file.path;
      button.dataset.path = editorPath(file.path);
      if (editorPath(file.path) === activeFile) button.classList.add("active");
      button.onclick = () => void openFile(file.path, false);
      row.append(button);
      fileTree.append(row);
    }
    return;
  }
  interface TreeNode {
    readonly directories: Map<string, TreeNode>;
    readonly files: DesktopFile[];
  }
  const root: TreeNode = { directories: new Map(), files: [] };
  for (const file of files) {
    const parts = file.path.split(/[\\/]/).filter(Boolean);
    const fileName = file.type === "file" ? parts.pop() : undefined;
    let node = root;
    for (const part of parts) {
      let child = node.directories.get(part);
      if (!child) {
        child = { directories: new Map(), files: [] };
        node.directories.set(part, child);
      }
      node = child;
    }
    if (fileName) node.files.push(file);
  }
  const renderNode = (node: TreeNode, path: string, depth: number): void => {
    const directories = [...node.directories.entries()].sort(
      ([left], [right]) => left.localeCompare(right),
    );
    for (const [name, child] of directories) {
      const directoryPath = path ? `${path}/${name}` : name;
      const row = document.createElement("div");
      row.className = "tree-row directory";
      row.style.setProperty("--depth", String(depth));
      const button = document.createElement("button");
      const expanded = expandedDirectories.has(directoryPath);
      button.className = "folder-button";
      button.dataset.path = editorPath(directoryPath);
      button.dataset.expanded = String(expanded);
      const arrow = document.createElement("span");
      arrow.className = "tree-arrow";
      arrow.textContent = expanded ? "v" : ">";
      const icon = document.createElement("span");
      icon.className = "folder-icon";
      icon.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.textContent = name;
      button.append(arrow, icon, label);
      button.title = directoryPath;
      button.setAttribute("aria-expanded", String(expanded));
      button.onclick = async () => {
        if (expanded) {
          expandedDirectories.delete(directoryPath);
        } else {
          expandedDirectories.add(directoryPath);
          try {
            await loadDirectoryContents(directoryPath);
          } catch (error) {
            notify(
              `Unable to read ${directoryPath}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
        renderFiles();
        saveWorkspaceUiState();
      };
      row.append(button);
      fileTree.append(row);
      if (expanded) renderNode(child, directoryPath, depth + 1);
    }
    for (const file of [...node.files].sort((left, right) =>
      left.path.localeCompare(right.path),
    )) {
      const row = document.createElement("div");
      row.className = "tree-row file";
      row.style.setProperty("--depth", String(depth));
      const button = document.createElement("button");
      appendFileLabel(
        button,
        file.path,
        file.path.split(/[\\/]/).at(-1) ?? file.path,
      );
      button.title = file.path;
      button.dataset.path = editorPath(file.path);
      if (editorPath(file.path) === activeFile) button.classList.add("active");
      button.onclick = () => void openFile(file.path, false);
      row.append(button);
      fileTree.append(row);
    }
  };
  renderNode(root, "", 0);
  fileTree.scrollTop = scrollTop;
}

function updateFileSelection(): void {
  fileTree
    .querySelectorAll<HTMLButtonElement>(".tree-row.file button")
    .forEach((button) => {
      button.classList.toggle("active", button.dataset.path === activeFile);
    });
}

function mergeFiles(entries: readonly DesktopFile[]): void {
  const merged = new Map(files.map((file) => [editorPath(file.path), file]));
  entries.forEach((file) => merged.set(editorPath(file.path), file));
  files = [...merged.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}

async function loadDirectoryContents(path: string): Promise<void> {
  if (loadedDirectoryContents.has(path)) return;
  const entries = await window.trussDesktop.listDirectory(path);
  mergeFiles(entries);
  loadedDirectoryContents.add(path);
}

function requestConfirmation(options: {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel?: string;
  readonly danger?: boolean;
}): Promise<boolean> {
  if (resolveConfirmation)
    return Promise.reject(new Error("Finish the current confirmation first."));
  confirmTitle.textContent = options.title;
  confirmMessage.textContent = options.message;
  acceptConfirm.textContent = options.confirmLabel ?? "Confirm";
  acceptConfirm.classList.toggle("danger", options.danger === true);
  confirmDialog.showModal();
  window.requestAnimationFrame(() => acceptConfirm.focus());
  return new Promise((resolve) => {
    resolveConfirmation = resolve;
  });
}

function renderConversations(): void {
  conversations.replaceChildren();
  desktopState.conversations.forEach((conversation) => {
    const row = document.createElement("div");
    row.className = "conversation-row";
    const select = document.createElement("button");
    select.type = "button";
    select.textContent = conversation.title;
    select.title = conversation.title;
    if (conversation.id === desktopState.activeConversationId)
      select.classList.add("active");
    select.onclick = () => {
      if (conversation.id !== desktopState.activeConversationId)
        cancelActiveRunForNavigation();
      desktopState = { ...desktopState, activeConversationId: conversation.id };
      finishConversationNavigation();
    };
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "delete";
    remove.textContent = "x";
    remove.title = "Delete conversation";
    remove.onclick = async () => {
      if (!(await requestConfirmation({
        title: "Delete conversation",
        message: `Delete "${conversation.title}"?`,
        confirmLabel: "Delete",
        danger: true,
      }))) return;
      if (conversation.id === desktopState.activeConversationId)
        cancelActiveRunForNavigation();
      const remaining = desktopState.conversations.filter(
        (item) => item.id !== conversation.id,
      );
      desktopState = {
        ...desktopState,
        conversations: remaining,
        activeConversationId:
          desktopState.activeConversationId === conversation.id
            ? remaining[0]?.id
            : desktopState.activeConversationId,
      };
      finishConversationNavigation();
    };
    row.append(select, remove);
    conversations.append(row);
  });
}

let conversationNavigationFrame = 0;

function finishConversationNavigation(): void {
  conversationNavigationFrame = scheduleConversationNavigation(
    conversationNavigationFrame,
    {
      save: saveConversations,
      cancelFrame: (frame) => window.cancelAnimationFrame(frame),
      requestFrame: (callback) => window.requestAnimationFrame(callback),
      releaseFocus: () => {
        // Chromium on Linux can stop dispatching keyboard input when it keeps
        // focus on a button that is removed in the next animation frame.
        if (document.activeElement instanceof HTMLElement)
          document.activeElement.blur();
      },
      render: () => {
        // Rebuilding the list during its own click can leave Chromium focused
        // on a detached button on Linux, freezing keyboard input app-wide.
        renderConversations();
        renderChat();
        renderRuntime();
      },
      restoreFocus: () => {
        window.focus();
        chatInput.focus({ preventScroll: true });
      },
    },
  );
}

function workspaceFileReference(path: string): string | undefined {
  const normalizedPath = path.replaceAll("\\", "/").replace(/^\.\//, "");
  if (
    !normalizedPath ||
    normalizedPath.startsWith("/") ||
    normalizedPath.split("/").some((part) => part === "..")
  )
    return undefined;
  return files.some(
    (file) => file.type === "file" && editorPath(file.path) === normalizedPath,
  )
    ? normalizedPath
    : undefined;
}

function openChatFile(path: string): void {
  setCenterView("editor");
  void openFile(path, false).catch((error) =>
    notify(error instanceof Error ? error.message : String(error)),
  );
}

function appendFileReference(
  parent: HTMLElement,
  path: string,
  label = path,
): void {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "chat-file-link";
  button.textContent = label;
  button.title = `Open ${path}`;
  button.onclick = () => openChatFile(path);
  parent.append(button);
}

function appendTextWithFileReferences(parent: HTMLElement, text: string): void {
  const filePath =
    /(?:\.{1,2}\/)?(?:[A-Za-z0-9_@.-]+\/)*(?:[A-Za-z0-9_-]+\.[A-Za-z0-9][A-Za-z0-9_.-]*|\.[A-Za-z0-9_-]+)/g;
  let cursor = 0;
  for (const match of text.matchAll(filePath)) {
    const index = match.index ?? 0;
    const reference = workspaceFileReference(match[0]);
    if (!reference) continue;
    if (index > cursor)
      parent.append(document.createTextNode(text.slice(cursor, index)));
    appendFileReference(parent, reference, match[0]);
    cursor = index + match[0].length;
  }
  if (cursor < text.length)
    parent.append(document.createTextNode(text.slice(cursor)));
}

function appendInlineMarkdown(parent: HTMLElement, text: string): void {
  const token =
    /(`[^`]*`)|(\[([^\]]+)\]\(([^\s)]+)\))|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)/g;
  let cursor = 0;
  for (const match of text.matchAll(token)) {
    const index = match.index ?? 0;
    if (index > cursor)
      appendTextWithFileReferences(parent, text.slice(cursor, index));
    if (match[1]) {
      const codeText = match[1].slice(1, -1);
      const reference = workspaceFileReference(codeText);
      if (reference) appendFileReference(parent, reference, codeText);
      else {
        const code = document.createElement("code");
        code.textContent = codeText;
        parent.append(code);
      }
    } else if (match[2]) {
      const href = match[4] ?? "";
      const reference = workspaceFileReference(href);
      if (reference) {
        appendFileReference(parent, reference, match[3] ?? reference);
      } else {
        const link = document.createElement("a");
        link.textContent = match[3] ?? href;
        if (/^(https?:|mailto:)/i.test(href)) {
          link.href = href;
          link.target = "_blank";
          link.rel = "noreferrer";
        }
        parent.append(link);
      }
    } else if (match[5]) {
      const strong = document.createElement("strong");
      strong.textContent = match[6] ?? "";
      parent.append(strong);
    } else if (match[7]) {
      const emphasis = document.createElement("em");
      emphasis.textContent = match[8] ?? "";
      parent.append(emphasis);
    }
    cursor = index + match[0].length;
  }
  if (cursor < text.length)
    appendTextWithFileReferences(parent, text.slice(cursor));
}

function appendHighlightedCode(
  parent: HTMLElement,
  code: string,
  language = "",
): void {
  const aliases: Readonly<Record<string, string>> = {
    html: "xml",
    shell: "bash",
    sh: "bash",
    tsx: "typescript",
    jsx: "javascript",
    vue: "xml",
    svelte: "xml",
    svg: "xml",
    yml: "yaml",
  };
  const resolvedLanguage =
    aliases[language.toLowerCase()] ?? language.toLowerCase();
  if (
    !resolvedLanguage ||
    resolvedLanguage === "text" ||
    !hljs.getLanguage(resolvedLanguage)
  ) {
    parent.textContent = code;
    return;
  }
  // highlight.js escapes source before producing its token spans.
  const template = document.createElement("template");
  template.innerHTML = hljs.highlight(code, {
    language: resolvedLanguage,
    ignoreIllegals: true,
  }).value;
  parent.replaceChildren(template.content);
}

function renderMarkdown(container: HTMLElement, content: string): void {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  for (let index = 0; index < lines.length; ) {
    const line = lines[index];
    const fence = line.match(/^```([^\s]*)\s*$/);
    if (fence) {
      const language = fence[1] || "text";
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index]))
        code.push(lines[index++]);
      if (index < lines.length) index += 1;
      const block = document.createElement("div");
      block.className = "code-block";
      const label = document.createElement("div");
      label.className = "code-language";
      label.textContent = language;
      const pre = document.createElement("pre");
      const codeElement = document.createElement("code");
      appendHighlightedCode(codeElement, code.join("\n"), language);
      pre.append(codeElement);
      block.append(label, pre);
      container.append(block);
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const element = document.createElement(
        `h${heading[1].length}`,
      ) as HTMLHeadingElement;
      appendInlineMarkdown(element, heading[2]);
      container.append(element);
      index += 1;
      continue;
    }
    const list = line.match(/^[-*+]\s+(.+)$/);
    if (list) {
      const listElement = document.createElement("ul");
      do {
        const item = document.createElement("li");
        appendInlineMarkdown(item, lines[index].replace(/^[-*+]\s+/, ""));
        listElement.append(item);
        index += 1;
      } while (index < lines.length && /^[-*+]\s+/.test(lines[index]));
      container.append(listElement);
      continue;
    }
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      const blockquote = document.createElement("blockquote");
      appendInlineMarkdown(blockquote, quote[1]);
      container.append(blockquote);
      index += 1;
      continue;
    }
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const paragraph = document.createElement("p");
    const paragraphLines = [line];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(#{1,4}\s|```|[-*+]\s+|>\s?)/.test(lines[index])
    )
      paragraphLines.push(lines[index++]);
    appendInlineMarkdown(paragraph, paragraphLines.join("\n"));
    container.append(paragraph);
  }
}

function messageView(
  message: DesktopMessage,
  activePlaceholder = false,
): HTMLElement {
  const view = document.createElement("div");
  view.className = `message ${message.role}`;
  const role = document.createElement("span");
  role.className = "role";
  role.textContent = message.role === "user" ? "YOU" : "AGENT";
  const content = document.createElement("div");
  content.className = "markdown";
  if (!message.content && activePlaceholder && message.role === "assistant") {
    content.className = "thinking";
    content.textContent = "Thinking...";
  } else {
    renderMarkdown(content, message.content);
  }
  view.append(role, content);
  if (message.attachments?.length) {
    const attachments = document.createElement("div");
    attachments.className = "message-attachments";
    for (const attachment of message.attachments) {
      const item = document.createElement("div");
      item.className = "message-attachment";
      if (attachment.kind === "image" && attachment.data) {
        const image = document.createElement("img");
        image.src = attachment.data;
        image.alt = attachment.name;
        item.append(image);
      }
      const label = document.createElement("span");
      label.textContent = `${attachment.name} (${Math.max(1, Math.ceil(attachment.size / 1024))} KB)`;
      item.append(label);
      attachments.append(item);
    }
    view.append(attachments);
  }
  return view;
}

function renderChat(): void {
  chatMessages.replaceChildren();
  const conversation = activeConversation();
  if (!conversation || !conversation.messages.length) {
    const empty = document.createElement("div");
    empty.className = "empty-chat";
    empty.textContent =
      "Select a local model, then ask about the workspace. Plan is read-only; Agent can edit files and run commands.";
    chatMessages.append(empty);
    toolActivityPanel.hidden = true;
    return;
  }
  const activities = toolActivityByConversation.get(conversation.id) ?? [];
  if (activities.length) {
    toolActivityPanel.hidden = false;
    toolActivityPanel.replaceChildren(
      toolActivityView(conversation.id, activities),
    );
  } else {
    toolActivityPanel.hidden = true;
  }
  const lastAssistantIndex = conversation.messages
    .map((message) => message.role)
    .lastIndexOf("assistant");
  const showActivePlaceholder =
    busy && conversation.id === runningConversationId;
  conversation.messages.forEach((message, index) => {
    chatMessages.append(
      messageView(
        message,
        showActivePlaceholder && index === lastAssistantIndex,
      ),
    );
  });
  if (conversation.lastRun) {
    const result = document.createElement("div");
    result.className = `run-result ${conversation.lastRun.status}`;
    if (conversation.lastRun.status === "running") {
      // The assistant placeholder below the activity trace remains the visible
      // bottom-most state while a run is active.
      result.hidden = true;
    } else if (conversation.lastRun.status === "failed") {
      result.textContent =
        "Run did not complete. No file changes are verified.";
    } else if (conversation.lastRun.modifiedFiles.length) {
      result.textContent = `Made all necessary changes: ${conversation.lastRun.modifiedFiles.join(", ")}`;
    } else {
      result.textContent = "No workspace file changes were verified.";
    }
    if (conversation.lastRun.usage) {
      const usage = conversation.lastRun.usage;
      const cost = usage.estimatedCostUsd !== undefined
        ? ` · ${formatUsd(usage.estimatedCostUsd)}`
        : "";
      result.textContent += ` · ${formatTokens(usage.inputTokens)} in / ${formatTokens(usage.outputTokens)} out${cost}${usage.estimated ? " est." : ""}`;
      result.title = "Provider usage when available; otherwise estimated from message text.";
    }
    chatMessages.append(result);
  }
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function renderPlan(): void {
  planPanel.hidden = !activePlan;
  if (!activePlan) return;
  const title = document.createElement("strong");
  title.textContent = activePlan.title;
  const list = document.createElement("div");
  list.className = "plan-steps";
  for (const step of activePlan.steps) {
    const row = document.createElement("div");
    row.className = `plan-step ${step.status}`;
    row.textContent = `${step.status === "completed" ? "[x]" : step.status === "in_progress" ? "[..]" : "[ ]"} ${step.content}`;
    list.append(row);
  }
  planPanel.replaceChildren(title, list);
}

function appendToolMessage(text: string): void {
  const tool = document.createElement("div");
  tool.className = "tool-message";
  tool.textContent = text;
  chatMessages.append(tool);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function createConversation(): DesktopConversation {
  const conversation: DesktopConversation = {
    id: createId(),
    title: "New conversation",
    messages: [],
    updatedAt: new Date().toISOString(),
  };
  desktopState = {
    ...desktopState,
    conversations: [conversation, ...desktopState.conversations],
    activeConversationId: conversation.id,
  };
  return conversation;
}

function ensureConversation(): DesktopConversation {
  return activeConversation() ?? createConversation();
}

function updateConversation(
  conversationId: string,
  update: (conversation: DesktopConversation) => DesktopConversation,
): void {
  desktopState = {
    ...desktopState,
    conversations: desktopState.conversations.map((conversation) =>
      conversation.id === conversationId ? update(conversation) : conversation,
    ),
  };
}

function setToolActivity(
  conversationId: string,
  activities: readonly ToolActivity[],
): void {
  toolActivityByConversation.set(conversationId, [...activities]);
  updateConversation(conversationId, (current) => ({
    ...current,
    toolActivity: [...activities],
  }));
  saveConversations();
}

function languageForPath(path: string): string {
  const extension = path.split(".").at(-1)?.toLowerCase() ?? "";
  const languages: Record<string, string> = {
    cjs: "javascript",
    css: "css",
    go: "go",
    htm: "html",
    html: "html",
    java: "java",
    js: "javascript",
    json: "json",
    jsx: "jsx",
    md: "markdown",
    mjs: "javascript",
    php: "php",
    py: "python",
    rb: "ruby",
    rs: "rust",
    scss: "scss",
    sh: "shell",
    sql: "sql",
    svelte: "svelte",
    svg: "svg",
    toml: "toml",
    ts: "typescript",
    tsx: "tsx",
    vue: "vue",
    xml: "xml",
    yaml: "yaml",
    yml: "yaml",
  };
  return languages[extension] ?? extension;
}

function mediaKindForPath(path: string): "image" | "video" | undefined {
  const extension = path.split(".").at(-1)?.toLowerCase();
  if (extension && ["jpg", "jpeg", "png", "svg", "webp"].includes(extension))
    return "image";
  if (extension && ["mp4", "webm"].includes(extension)) return "video";
  return undefined;
}

function renderFileDiffToggle(): void {
  fileDiffToggle.textContent = showingDiff ? "File" : "Diff";
  fileDiffToggle.title = showingDiff
    ? "Show the current file"
    : "Show the current file's diff";
  fileDiffToggle.setAttribute(
    "aria-label",
    showingDiff ? "Show file" : "Show diff",
  );
}

function workspaceMediaUrl(path: string): string {
  return `truss-media://workspace/${encodeURIComponent(path.replaceAll("\\", "/"))}`;
}

function editorPath(path: string): string {
  return path.replaceAll("\\", "/");
}

function activeEditorTab(): EditorTab | undefined {
  return activeFile
    ? openEditorTabs.find((tab) => tab.path === activeFile)
    : undefined;
}

function activeWorkspaceFilePath(): string | undefined {
  return activeEditorTab()?.mode === "settings" ? undefined : activeFile;
}

function preserveEditorScroll(): void {
  const tab = activeEditorTab();
  const input = editor.querySelector<HTMLTextAreaElement>("textarea");
  if (tab) tab.scrollTop = input?.scrollTop ?? editor.scrollTop;
}

function renderEditorContent(tab: EditorTab | undefined): void {
  renderFileDiffToggle();
  editor.className = "editor-content";
  settingsPanel.hidden = true;
  if (settingsPanel.parentElement === editor)
    settingsPanelHome.after(settingsPanel);
  editor.replaceChildren();
  if (!tab) {
    editor.append(
      document.createTextNode("Open a workspace file to inspect it."),
    );
    editor.scrollTop = 0;
    return;
  }
  if (tab.mode === "settings") {
    editor.classList.add("settings-content");
    settingsPanel.hidden = false;
    editor.append(settingsPanel);
  } else if (tab.state === "loading") {
    editor.classList.add("loading");
    editor.append(document.createTextNode(`Loading ${tab.path}...`));
  } else if (tab.state === "error") {
    editor.classList.add("error");
    editor.append(document.createTextNode(tab.content));
  } else if (tab.mode === "file" && mediaKindForPath(tab.path)) {
    const kind = mediaKindForPath(tab.path);
    editor.classList.add("media");
    const stage = document.createElement("span");
    stage.className = "editor-media-stage";
    const showError = (): void => {
      const error = document.createElement("span");
      error.className = "editor-media-error";
      error.textContent = `Unable to display ${tab.path}.`;
      stage.replaceChildren(error);
    };
    if (kind === "image") {
      const image = document.createElement("img");
      image.className = "editor-media-image";
      image.src = workspaceMediaUrl(tab.path);
      image.alt = tab.path;
      image.draggable = false;
      image.title = "Click to toggle actual size";
      image.onerror = showError;
      image.onclick = () => image.classList.toggle("actual-size");
      stage.append(image);
    } else {
      const video = document.createElement("video");
      video.className = "editor-media-video";
      video.src = workspaceMediaUrl(tab.path);
      video.controls = true;
      video.preload = "metadata";
      video.onerror = showError;
      stage.append(video);
    }
    editor.append(stage);
  } else if (tab.mode === "diff") {
    const language = languageForPath(tab.path);
    for (const line of tab.content.replace(/\r\n/g, "\n").split("\n")) {
      const row = document.createElement("span");
      row.className = "editor-diff-line";
      if (line.startsWith("+") && !line.startsWith("+++"))
        row.classList.add("added");
      else if (line.startsWith("-") && !line.startsWith("---"))
        row.classList.add("removed");
      else if (line.startsWith("@@")) row.classList.add("hunk");
      const marker = document.createElement("span");
      marker.className = "diff-marker";
      marker.textContent =
        line[0] === "+" || line[0] === "-" || line[0] === " " ? line[0] : " ";
      const code = document.createElement("span");
      appendHighlightedCode(
        code,
        marker.textContent.trim() ? line.slice(1) : line,
        language,
      );
      row.append(marker, code);
      editor.append(row);
    }
  } else {
    const surface = document.createElement("div");
    surface.className = "editor-edit-surface";
    const lineNumbers = document.createElement("pre");
    lineNumbers.className = "editor-line-numbers";
    const highlight = document.createElement("pre");
    highlight.className = "editor-highlight";
    const code = document.createElement("code");
    appendHighlightedCode(code, tab.content, languageForPath(tab.path));
    highlight.append(code);
    const input = document.createElement("textarea");
    input.className = "editor-input";
    input.value = tab.content;
    input.spellcheck = false;
    input.setAttribute("aria-label", `Edit ${tab.path}`);
    const occurrenceLayer = document.createElement("div");
    occurrenceLayer.className = "editor-occurrence-layer";
    type OccurrenceRange = { start: number; end: number };
    let occurrenceRanges: OccurrenceRange[] = [];
    let occurrenceNeedle = "";
    type EditorHistoryEntry = {
      readonly content: string;
      readonly selectionStart: number;
      readonly selectionEnd: number;
    };
    const editHistory: EditorHistoryEntry[] = [
      {
        content: input.value,
        selectionStart: input.selectionStart,
        selectionEnd: input.selectionEnd,
      },
    ];
    let editHistoryIndex = 0;
    const suggestion = document.createElement("div");
    suggestion.className = "inline-completion";
    suggestion.hidden = true;
    const diagnostics = document.createElement("div");
    diagnostics.className = "editor-diagnostics";
    diagnostics.hidden = true;
    const refreshDiagnostics = (): void => {
      window.clearTimeout(syntaxTimer);
      syntaxTimer = window.setTimeout(() => {
        void window.trussDesktop
          .checkSyntax(tab.path, input.value)
          .then((items) => {
            if (input.value !== tab.content) return;
            diagnostics.hidden = items.length === 0;
            diagnostics.textContent = items
              .map((item) => `Line ${item.line}: ${item.message}`)
              .join("\n");
          })
          .catch(() => undefined);
      }, 250);
    };
    const requestCompletion = (): void => {
      window.clearTimeout(completionTimer);
      inlineCompletion = "";
      suggestion.hidden = true;
      if (
        !configuration().autocomplete?.enabled ||
        input.selectionStart !== input.selectionEnd
      )
        return;
      const cursor = input.selectionStart;
      const prefix = input.value.slice(0, cursor);
      if (prefix.trim().length < 3) return;
      const request = ++completionRequest;
      completionTimer = window.setTimeout(() => {
        void window.trussDesktop
          .complete({
            prefix,
            suffix: input.value.slice(cursor),
            path: tab.path,
          })
          .then((completion) => {
            if (
              request !== completionRequest ||
              !completion ||
              input.value !== tab.content
            )
              return;
            inlineCompletion = completion;
            const currentLine = prefix.slice(prefix.lastIndexOf("\n") + 1);
            const line = prefix.split("\n").length - 1;
            suggestion.textContent = completion.split("\n", 1)[0];
            suggestion.style.left = `${62 + currentLine.length * 7.22 - input.scrollLeft}px`;
            suggestion.style.top = `${12 + line * 18 - input.scrollTop}px`;
            suggestion.hidden = false;
          })
          .catch(() => undefined);
      }, 350);
    };
    const renderLineNumbers = () => {
      lineNumbers.textContent = Array.from(
        { length: Math.max(1, tab.content.split("\n").length) },
        (_, index) => String(index + 1),
      ).join("\n");
    };
    const renderOccurrenceRanges = (): void => {
      occurrenceLayer.replaceChildren();
      if (occurrenceRanges.length < 2) return;
      const lines = input.value.split("\n");
      for (const range of occurrenceRanges.slice(0, -1)) {
        const before = input.value.slice(0, range.start);
        const startLine = before.split("\n").length - 1;
        const startColumn = before.length - (before.lastIndexOf("\n") + 1);
        const selectedText = input.value.slice(range.start, range.end);
        const selectedLines = selectedText.split("\n");
        for (let index = 0; index < selectedLines.length; index += 1) {
          const line = startLine + index;
          const column = index === 0 ? startColumn : 0;
          const length = selectedLines[index]?.length ?? 0;
          const isFinalLine = index === selectedLines.length - 1;
          const width = isFinalLine
            ? length
            : Math.max(1, (lines[line]?.length ?? 0) - column);
          if (width === 0) continue;
          const marker = document.createElement("span");
          marker.className = "editor-occurrence";
          marker.style.left = `${62 + column * 7.22 - input.scrollLeft}px`;
          marker.style.top = `${12 + line * 18 - input.scrollTop}px`;
          marker.style.width = `${Math.max(1, width) * 7.22}px`;
          occurrenceLayer.append(marker);
        }
      }
    };
    const clearOccurrenceRanges = (): void => {
      occurrenceRanges = [];
      occurrenceNeedle = "";
      renderOccurrenceRanges();
    };
    const updateEditorContent = (): void => {
      tab.content = input.value;
      tab.dirty = true;
      renderLineNumbers();
      code.replaceChildren();
      appendHighlightedCode(code, tab.content, languageForPath(tab.path));
      renderEditorTabs();
      requestCompletion();
      refreshDiagnostics();
    };
    const recordEditHistory = (): void => {
      const entry: EditorHistoryEntry = {
        content: input.value,
        selectionStart: input.selectionStart,
        selectionEnd: input.selectionEnd,
      };
      const current = editHistory[editHistoryIndex];
      if (
        current?.content === entry.content &&
        current.selectionStart === entry.selectionStart &&
        current.selectionEnd === entry.selectionEnd
      )
        return;
      editHistory.splice(editHistoryIndex + 1);
      editHistory.push(entry);
      if (editHistory.length > 200) editHistory.shift();
      editHistoryIndex = editHistory.length - 1;
    };
    const restoreEditHistory = (direction: -1 | 1): void => {
      const nextIndex = editHistoryIndex + direction;
      if (nextIndex < 0 || nextIndex >= editHistory.length) return;
      editHistoryIndex = nextIndex;
      const entry = editHistory[editHistoryIndex] as EditorHistoryEntry;
      input.value = entry.content;
      clearOccurrenceRanges();
      input.setSelectionRange(entry.selectionStart, entry.selectionEnd);
      updateEditorContent();
    };
    const selectedWord = (): OccurrenceRange | undefined => {
      const cursor = input.selectionStart;
      const wordCharacter = /[A-Za-z0-9_$-]/;
      if (
        !wordCharacter.test(input.value[cursor] ?? "") &&
        !wordCharacter.test(input.value[cursor - 1] ?? "")
      )
        return undefined;
      let start = cursor;
      let end = cursor;
      while (start > 0 && wordCharacter.test(input.value[start - 1] ?? ""))
        start -= 1;
      while (
        end < input.value.length &&
        wordCharacter.test(input.value[end] ?? "")
      )
        end += 1;
      return start === end ? undefined : { start, end };
    };
    const selectNextOccurrence = (): void => {
      const currentSelection: OccurrenceRange | undefined =
        input.selectionStart === input.selectionEnd
          ? selectedWord()
          : { start: input.selectionStart, end: input.selectionEnd };
      if (!currentSelection) {
        notify("Select text or place the cursor inside a word first.");
        return;
      }
      const currentNeedle = input.value.slice(
        currentSelection.start,
        currentSelection.end,
      );
      const selectedRangeIndex = occurrenceRanges.findIndex(
        (range) =>
          range.start === currentSelection.start &&
          range.end === currentSelection.end,
      );
      if (currentNeedle !== occurrenceNeedle || selectedRangeIndex < 0) {
        occurrenceNeedle = currentNeedle;
        occurrenceRanges = [currentSelection];
      }
      const activeRange = occurrenceRanges.at(-1) as OccurrenceRange;
      let nextStart = input.value.indexOf(occurrenceNeedle, activeRange.end);
      if (nextStart < 0) nextStart = input.value.indexOf(occurrenceNeedle);
      while (
        nextStart >= 0 &&
        occurrenceRanges.some((range) => range.start === nextStart)
      ) {
        nextStart = input.value.indexOf(
          occurrenceNeedle,
          nextStart + occurrenceNeedle.length,
        );
      }
      if (nextStart < 0) {
        notify(
          `${occurrenceRanges.length} occurrence${occurrenceRanges.length === 1 ? "" : "s"} selected; no more matches.`,
        );
        input.setSelectionRange(activeRange.start, activeRange.end);
        return;
      }
      const nextRange = {
        start: nextStart,
        end: nextStart + occurrenceNeedle.length,
      };
      occurrenceRanges.push(nextRange);
      input.setSelectionRange(nextRange.start, nextRange.end);
      renderOccurrenceRanges();
      notify(`${occurrenceRanges.length} occurrences selected`);
    };
    renderLineNumbers();
    input.oninput = () => {
      clearOccurrenceRanges();
      recordEditHistory();
      updateEditorContent();
    };
    input.addEventListener("beforeinput", (event) => {
      const inputEvent = event as InputEvent;
      if (occurrenceRanges.length < 2) return;
      const replacement =
        inputEvent.data ??
        inputEvent.dataTransfer?.getData("text/plain") ??
        (inputEvent.inputType === "insertLineBreak" ? "\n" : undefined);
      const deleting =
        inputEvent.inputType === "deleteContentBackward" ||
        inputEvent.inputType === "deleteContentForward";
      if (replacement === undefined && !deleting) return;
      event.preventDefault();
      const activeRange = occurrenceRanges.at(-1) as OccurrenceRange;
      const sortedRanges = [...occurrenceRanges].sort(
        (left, right) => right.start - left.start,
      );
      for (const range of sortedRanges)
        input.value = `${input.value.slice(0, range.start)}${replacement ?? ""}${input.value.slice(range.end)}`;
      const delta = (replacement ?? "").length - occurrenceNeedle.length;
      const earlierRanges = occurrenceRanges.filter(
        (range) => range.start < activeRange.start,
      ).length;
      const cursor =
        activeRange.start + earlierRanges * delta + (replacement ?? "").length;
      clearOccurrenceRanges();
      input.setSelectionRange(cursor, cursor);
      recordEditHistory();
      updateEditorContent();
    });
    input.onkeydown = (event) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "z"
      ) {
        event.preventDefault();
        restoreEditHistory(event.shiftKey ? 1 : -1);
        return;
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "y"
      ) {
        event.preventDefault();
        restoreEditHistory(1);
        return;
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "d"
      ) {
        event.preventDefault();
        selectNextOccurrence();
        return;
      }
      if (event.key === "Tab" && inlineCompletion) {
        event.preventDefault();
        input.setRangeText(
          inlineCompletion,
          input.selectionStart,
          input.selectionEnd,
          "end",
        );
        inlineCompletion = "";
        suggestion.hidden = true;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return;
      }
      if (event.key === "Escape" && inlineCompletion) {
        inlineCompletion = "";
        suggestion.hidden = true;
        return;
      }
      if (event.key === "Escape" && occurrenceRanges.length > 0) {
        clearOccurrenceRanges();
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        const start = input.selectionStart;
        const end = input.selectionEnd;
        input.setRangeText("  ", start, end, "end");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return;
      }
      if (
        event.key !== "Enter" ||
        (!event.ctrlKey && !event.metaKey && !event.shiftKey)
      )
        return;
      event.preventDefault();
      const selection = event.shiftKey
        ? input.selectionStart
        : input.selectionEnd;
      const lineStart =
        input.value.lastIndexOf("\n", Math.max(0, selection - 1)) + 1;
      const nextLine = input.value.indexOf("\n", selection);
      const insertionPoint = event.shiftKey
        ? lineStart
        : nextLine < 0
          ? input.value.length
          : nextLine;
      input.setRangeText("\n", insertionPoint, insertionPoint, "end");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    input.onscroll = () => {
      tab.scrollTop = input.scrollTop;
      highlight.scrollTop = input.scrollTop;
      highlight.scrollLeft = input.scrollLeft;
      lineNumbers.scrollTop = input.scrollTop;
      renderOccurrenceRanges();
      saveWorkspaceUiState();
    };
    editor.classList.add("editable");
    surface.append(
      lineNumbers,
      highlight,
      occurrenceLayer,
      input,
      suggestion,
      diagnostics,
    );
    refreshDiagnostics();
    editor.append(surface);
  }
  window.requestAnimationFrame(() => {
    const input = editor.querySelector<HTMLTextAreaElement>("textarea");
    if (input) {
      input.scrollTop = tab.scrollTop;
      const highlight = editor.querySelector<HTMLElement>(".editor-highlight");
      if (highlight) highlight.scrollTop = tab.scrollTop;
      const lineNumbers = editor.querySelector<HTMLElement>(
        ".editor-line-numbers",
      );
      if (lineNumbers) lineNumbers.scrollTop = tab.scrollTop;
    } else editor.scrollTop = tab.scrollTop;
  });
}

function selectEditorTab(tab: EditorTab): void {
  preserveEditorScroll();
  activeFile = tab.path;
  showingDiff = tab.mode === "diff";
  setCenterView("editor");
  renderEditorTabs();
  renderEditorContent(tab);
  updateFileSelection();
  saveWorkspaceUiState();
}

function openSettings(): void {
  let tab = openEditorTabs.find((candidate) => candidate.mode === "settings");
  if (tab && tab.path === activeFile) {
    closeEditorTab(tab.path);
    return;
  }
  populateSettings();
  if (!tab) {
    tab = {
      path: settingsEditorPath,
      mode: "settings",
      state: "ready",
      content: "",
      dirty: false,
      scrollTop: 0,
      revision: 0,
    };
    openEditorTabs.push(tab);
  }
  selectEditorTab(tab as EditorTab);
}

function closeEditorTab(path: string): void {
  const index = openEditorTabs.findIndex((tab) => tab.path === path);
  if (index < 0) return;
  if (openEditorTabs[index].dirty) {
    void requestConfirmation({
      title: "Close unsaved editor",
      message: `Close ${path} without saving your edits?`,
      confirmLabel: "Close",
      danger: true,
    }).then((confirmed) => {
      if (confirmed) {
        openEditorTabs[index].dirty = false;
        closeEditorTab(path);
      }
    });
    return;
  }
  const wasActive = activeFile === path;
  if (wasActive) preserveEditorScroll();
  openEditorTabs.splice(index, 1);
  if (wasActive) {
    const next = openEditorTabs[Math.min(index, openEditorTabs.length - 1)];
    activeFile = undefined;
    showingDiff = false;
    if (next) {
      selectEditorTab(next);
      return;
    }
    editorTitle.textContent = "Workspace";
    renderEditorContent(undefined);
    updateFileSelection();
  }
  renderEditorTabs();
  saveWorkspaceUiState();
}

function renderEditorTabs(): void {
  editorTitle.hidden = openEditorTabs.length > 0;
  const tabs = openEditorTabs.map((tab) => {
    const container = document.createElement("div");
    container.className = `editor-tab ${tab.mode === "diff" ? "diff" : ""} ${tab.path === activeFile ? "active" : ""}`;
    container.setAttribute("role", "presentation");
    const select = document.createElement("button");
    select.className = "editor-tab-main";
    select.type = "button";
    select.setAttribute("role", "tab");
    select.setAttribute("aria-selected", String(tab.path === activeFile));
    if (tab.mode === "settings") select.textContent = "Settings";
    else
      appendFileLabel(
        select,
        tab.path,
        `${tab.dirty ? "* " : ""}${tab.path.split(/[\\/]/).at(-1) ?? tab.path}`,
      );
    select.title =
      tab.mode === "settings"
        ? "Settings"
        : `${tab.mode === "diff" ? "Diff: " : ""}${tab.path}`;
    select.onclick = () => selectEditorTab(tab);
    const close = document.createElement("button");
    close.className = "editor-tab-close";
    close.type = "button";
    close.textContent = "x";
    close.title =
      tab.mode === "settings" ? "Close Settings" : `Close ${tab.path}`;
    close.setAttribute(
      "aria-label",
      tab.mode === "settings" ? "Close Settings" : `Close ${tab.path}`,
    );
    close.onclick = () => closeEditorTab(tab.path);
    container.append(select, close);
    return container;
  });
  editorTabsElement.replaceChildren(editorTitle, ...tabs);
  const active = activeEditorTab();
}

async function loadEditorTab(tab: EditorTab): Promise<void> {
  const revision = ++tab.revision;
  tab.state = "loading";
  if (tab.path === activeFile) renderEditorContent(tab);
  try {
    const content =
      tab.mode === "file" && mediaKindForPath(tab.path)
        ? ""
        : tab.mode === "diff"
          ? await window.trussDesktop.diffFile(tab.path)
          : await window.trussDesktop.readFile(tab.path);
    if (revision !== tab.revision) return;
    tab.content = content;
    tab.dirty = false;
    tab.state = "ready";
  } catch (error) {
    if (revision !== tab.revision) return;
    tab.content = `Unable to open ${tab.path}: ${error instanceof Error ? error.message : String(error)}`;
    tab.state = "error";
  }
  if (tab.path === activeFile) renderEditorContent(tab);
}

async function openFile(
  path: string,
  diff: boolean,
  switchMode = false,
): Promise<void> {
  const normalizedPath = editorPath(path);
  let tab = openEditorTabs.find(
    (candidate) => candidate.path === normalizedPath,
  );
  if (!tab) {
    tab = {
      path: normalizedPath,
      mode: diff ? "diff" : "file",
      state: "loading",
      content: "",
      dirty: false,
      scrollTop: 0,
      revision: 0,
    };
    openEditorTabs.push(tab);
  } else if (switchMode && tab.mode !== (diff ? "diff" : "file")) {
    if (tab.dirty) {
      notify("Save or discard your edits before switching to the diff view.");
      return;
    }
    tab.mode = diff ? "diff" : "file";
    tab.scrollTop = 0;
  } else {
    selectEditorTab(tab);
    return;
  }
  selectEditorTab(tab);
  await loadEditorTab(tab);
}

async function loadFiles(): Promise<void> {
  try {
    files = await window.trussDesktop.listFiles();
    loadedDirectoryContents.clear();
    await Promise.all(
      [...expandedDirectories].map((path) =>
        loadDirectoryContents(path).catch(() => undefined),
      ),
    );
    renderFiles();
  } catch (error) {
    notify(error instanceof Error ? error.message : String(error));
  }
}

async function saveActiveFile(): Promise<void> {
  const tab = activeEditorTab();
  if (!tab || tab.mode !== "file" || mediaKindForPath(tab.path) || !tab.dirty)
    return;
  try {
    if (configuration().formatOnSave)
      tab.content = await window.trussDesktop.formatFile(tab.path, tab.content);
    await window.trussDesktop.writeFile(tab.path, tab.content);
    tab.dirty = false;
    renderEditorTabs();
    await Promise.all([loadFiles(), refreshGit()]);
    notify(`Saved ${tab.path}`);
  } catch (error) {
    notify(error instanceof Error ? error.message : String(error));
    renderEditorTabs();
  }
}

function fileIconKind(path: string): string {
  const name = path.split(/[\\/]/).at(-1)?.toLowerCase() ?? "";
  if (
    ["package.json", "tsconfig.json", ".eslintrc", ".prettierrc"].includes(name)
  )
    return "config";
  const extension = name.split(".").at(-1) ?? "";
  if (["ts", "tsx"].includes(extension)) return "typescript";
  if (["js", "jsx", "mjs", "cjs"].includes(extension)) return "javascript";
  if (["json", "yaml", "yml", "toml", "ini"].includes(extension))
    return "config";
  if (["css", "scss", "sass", "less"].includes(extension)) return "style";
  if (["html", "htm", "svg", "xml"].includes(extension)) return "markup";
  if (["md", "mdx", "txt"].includes(extension)) return "document";
  if (
    [
      "py",
      "go",
      "rs",
      "java",
      "kt",
      "c",
      "cc",
      "cpp",
      "h",
      "hpp",
      "php",
      "rb",
      "sh",
      "sql",
    ].includes(extension)
  )
    return extension;
  if (["png", "jpg", "jpeg", "webp", "gif", "ico"].includes(extension))
    return "image";
  return "plain";
}

function appendFileLabel(
  button: HTMLButtonElement,
  path: string,
  label: string,
): void {
  const icon = document.createElement("span");
  icon.className = `file-icon ${fileIconKind(path)}`;
  icon.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  text.textContent = label;
  button.replaceChildren(icon, text);
}

async function formatActiveFile(): Promise<void> {
  const tab = activeEditorTab();
  if (!tab || tab.mode !== "file" || mediaKindForPath(tab.path)) return;
  formatFileButton.disabled = true;
  try {
    tab.content = await window.trussDesktop.formatFile(tab.path, tab.content);
    tab.dirty = true;
    renderEditorTabs();
    renderEditorContent(tab);
    notify(`Formatted ${tab.path}`);
  } catch (error) {
    notify(error instanceof Error ? error.message : String(error));
  } finally {
    formatFileButton.disabled = false;
  }
}

async function discover(input?: Partial<DesktopConfiguration>): Promise<void> {
  const result = await window.trussDesktop.discoverModels(input);
  endpoints = result.endpoints;
  models = result.models;
  endpointSelect.replaceChildren(
    ...[
      { id: "", label: "Custom endpoint", kind: "", baseUrl: "" },
      ...endpoints,
    ].map((endpoint) => {
      const option = document.createElement("option");
      option.value = endpoint.id ? JSON.stringify(endpoint) : "";
      option.textContent =
        endpoint.label + (endpoint.baseUrl ? ` (${endpoint.baseUrl})` : "");
      return option;
    }),
  );
  modelOptions.replaceChildren(
    ...models.map((model) => {
      const option = document.createElement("option");
      option.value = model.id;
      return option;
    }),
  );
  renderRuntime();
}

function settingsConfiguration(): DesktopConfiguration {
  const current = configuration();
  const provider = selectedSettingsProvider();
  const reusingCurrentProvider = provider === current.provider;
  const baseUrl = isLocalProvider(provider)
    ? baseUrlInput.value.trim() ||
      (reusingCurrentProvider ? current.baseUrl : "")
    : byokBaseUrlForSelectedProvider() ||
      (reusingCurrentProvider ? current.baseUrl : "");
  const model =
    (modelSettingsTab === "byok"
      ? byokModelInput.value
      : modelInput.value
    ).trim() || (reusingCurrentProvider ? current.model : "");
  if (!baseUrl || !model)
    throw new Error(
      "Choose a provider endpoint and model before applying agent settings.",
    );
  const mcpServers = mcpConfigurationsFromAdvancedJson();
  const modelContextWindow = selectedModelContextWindow(model);
  return {
    provider,
    baseUrl,
    model,
    credentialAccountId:
      modelSettingsTab === "byok" ? selectedProviderAccountId : undefined,
    mode: current.mode,
    permission:
      permissionSelect.value === "auto-read" ||
      permissionSelect.value === "auto-all"
        ? permissionSelect.value
        : "ask",
    contextWindow: isLocalProvider(provider)
      ? Math.max(512, Number.parseInt(contextInput.value, 10) || 8_192)
      : modelContextWindow ?? 8_192,
    ...(isLocalProvider(provider) || modelContextWindow === undefined
      ? {}
      : { modelContextWindow }),
    internetAccess: internetAccessInput.checked,
    autocomplete: {
      enabled: autocompleteEnabled.checked,
      model: autocompleteModel.value.trim() || undefined,
    },
    formatOnSave: formatOnSave.checked,
    mcpServers,
  };
}

function mcpConfigurationsFromAdvancedJson(): Record<
  string,
  McpStdioServerConfiguration
> {
  const source = mcpServersInput.value.trim();
  if (!source) return {};
  const parsed = JSON.parse(source) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("MCP servers must be a JSON object.");
  return parsed as Record<string, McpStdioServerConfiguration>;
}

function syncMcpAdvancedJson(): void {
  mcpServersInput.value = Object.keys(mcpDraft).length
    ? JSON.stringify(mcpDraft, null, 2)
    : "";
}

function openMcpEditor(name?: string): void {
  editingMcpName = name;
  const configuration = name ? mcpDraft[name] : undefined;
  mcpEditorTitle.textContent = configuration
    ? `Edit ${name}`
    : "Add MCP server";
  mcpNameInput.value = name ?? "";
  mcpNameInput.disabled = Boolean(configuration);
  mcpCommandInput.value = configuration?.command ?? "";
  mcpArgsInput.value = configuration?.args?.join("\n") ?? "";
  mcpCwdInput.value = configuration?.cwd ?? "";
  mcpEnabledInput.checked = configuration?.enabled !== false;
  mcpReadOnlyInput.checked = configuration?.readOnly === true;
  mcpServerEditor.hidden = false;
  (configuration ? mcpCommandInput : mcpNameInput).focus();
}

function closeMcpEditor(): void {
  editingMcpName = undefined;
  mcpServerEditor.hidden = true;
}

function renderMcpManager(): void {
  const runtimeStatuses = new Map(
    (desktopState.mcpStatuses ?? []).map((status) => [status.name, status]),
  );
  const names = Object.keys(mcpDraft).sort((left, right) =>
    left.localeCompare(right),
  );
  if (!names.length) {
    const empty = document.createElement("p");
    empty.className = "mcp-empty";
    empty.textContent =
      "No MCP servers configured. Add one to connect local tools.";
    mcpServerList.replaceChildren(empty);
    mcpStatus.textContent = "No MCP servers configured.";
    return;
  }
  mcpServerList.replaceChildren(
    ...names.map((name) => {
      const configuration = mcpDraft[name];
      const status = testedMcpStatuses.get(name) ??
        runtimeStatuses.get(name) ?? {
          name,
          state:
            configuration.enabled === false
              ? ("disabled" as const)
              : ("idle" as const),
          toolCount: 0,
        };
      const card = document.createElement("article");
      card.className = "mcp-server-card";
      const heading = document.createElement("div");
      heading.className = "mcp-server-card-heading";
      const identity = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = name;
      const command = document.createElement("span");
      command.textContent = configuration.command;
      identity.append(title, command);
      const badge = document.createElement("span");
      badge.className = `mcp-state ${status.state}`;
      badge.textContent = status.state;
      heading.append(identity, badge);
      const actions = document.createElement("div");
      actions.className = "mcp-server-actions";
      for (const [action, label] of [
        ["test", status.state === "connected" ? "Reconnect" : "Test"],
        ["edit", "Edit"],
        ["toggle", configuration.enabled === false ? "Enable" : "Disable"],
        ["remove", "Remove"],
      ] as const) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.mcpAction = action;
        button.dataset.mcpName = name;
        button.textContent = label;
        actions.append(button);
      }
      card.append(heading, actions);
      if (status.error) {
        const error = document.createElement("p");
        error.className = "mcp-card-error";
        error.textContent = status.error;
        card.append(error);
      }
      if (status.tools?.length) {
        const details = document.createElement("details");
        const summary = document.createElement("summary");
        summary.textContent = `${status.toolCount} tool${status.toolCount === 1 ? "" : "s"}`;
        const list = document.createElement("ul");
        for (const tool of status.tools) {
          const item = document.createElement("li");
          item.textContent = `${tool.name}${tool.readOnly ? " (read-only)" : ""}${tool.description ? ` — ${tool.description}` : ""}`;
          list.append(item);
        }
        details.append(summary, list);
        card.append(details);
      }
      return card;
    }),
  );
  mcpStatus.textContent = "Changes take effect when you Apply settings.";
}

function providerConnectionConfiguration(): DesktopConfiguration {
  const current = configuration();
  const provider = selectedSettingsProvider();
  const reusingCurrentProvider = provider === current.provider;
  const baseUrl = isLocalProvider(provider)
    ? baseUrlInput.value.trim() ||
      (reusingCurrentProvider ? current.baseUrl : "")
    : byokBaseUrlForSelectedProvider() ||
      (reusingCurrentProvider ? current.baseUrl : "");
  const model =
    (modelSettingsTab === "byok"
      ? byokModelInput.value
      : modelInput.value
    ).trim() || (reusingCurrentProvider ? current.model : "");
  if (!baseUrl || !model)
    throw new Error("Choose a provider endpoint and model before testing.");
  return {
    ...current,
    provider,
    baseUrl,
    model,
    credentialAccountId:
      modelSettingsTab === "byok" ? selectedProviderAccountId : undefined,
  };
}

function clearProviderConnectionResult(): void {
  providerConnectionResult.hidden = true;
  providerConnectionResult.textContent = "";
  providerConnectionResult.className = "provider-connection-result";
}

function renderCredentialStorageStatus(): void {
  const sessionOnly = credentialStorage === "session-only";
  credentialStorageStatus.hidden = !sessionOnly;
  credentialStorageStatus.className = sessionOnly
    ? "provider-connection-result failed"
    : "provider-connection-result";
  credentialStorageStatus.textContent = sessionOnly
    ? "Secure credential storage is unavailable. Keys are available for this app session only and are forgotten when Truss closes."
    : "";
}

function renderMcpStatus(): void {
  renderMcpManager();
}

function renderUpdate(
  status: Extract<DesktopEvent, { readonly type: "update" }>,
): void {
  const version = status.version ? ` ${status.version}` : "";
  updateStatus.textContent =
    status.status === "checking"
      ? "Checking for updates..."
      : status.status === "available"
        ? `Version${version} is available.`
        : status.status === "not-available"
          ? "Truss is up to date."
          : status.status === "downloading"
            ? `Downloading update${status.percent === undefined ? "..." : ` (${Math.round(status.percent)}%)`}`
            : status.status === "downloaded"
              ? `Version${version} is ready to install.`
              : (status.message ?? "Unable to check for updates.");
  downloadUpdate.hidden = status.status !== "available";
  installUpdate.hidden = status.status !== "downloaded";
  checkUpdates.disabled =
    status.status === "checking" || status.status === "downloading";
  downloadUpdate.disabled = status.status === "downloading";
}

function populateSettings(): void {
  const current = configuration();
  if (isLocalProvider(current.provider)) {
    providerSelect.value = current.provider;
    baseUrlInput.value = current.baseUrl;
    modelInput.value = current.model;
    setSettingsTab("local");
  } else {
    byokProviderSelect.value = current.provider;
    byokBaseUrl.value = current.baseUrl || byokBaseUrlForSelectedProvider();
    byokModelInput.value = current.model;
    byokModels = [];
    renderByokModels(current.model);
    creatingProviderAccount = false;
    renderProviderAccounts(current.credentialAccountId);
    setSettingsTab("byok");
  }
  contextInput.value = String(
    current.modelContextWindow ??
      (isLocalProvider(current.provider) ? current.contextWindow : 8_192),
  );
  contextInput.title = isLocalProvider(current.provider)
    ? "Context discovered from the local endpoint when available."
    : current.modelContextWindow !== undefined
      ? "Controlled by the selected cloud model."
      : "The provider did not publish context metadata; using a conservative fallback.";
  permissionSelect.value = current.permission;
  internetAccessInput.checked = current.internetAccess;
  autocompleteEnabled.checked = current.autocomplete?.enabled ?? false;
  autocompleteModel.value = current.autocomplete?.model ?? "";
  formatOnSave.checked = current.formatOnSave ?? false;
  mcpDraft = { ...current.mcpServers };
  testedMcpStatuses.clear();
  syncMcpAdvancedJson();
  checkUpdatesOnLaunch.checked = desktopState.updates.checkOnLaunch;
  autoDownloadUpdates.checked = desktopState.updates.autoDownload;
  themeSelect.value = desktopThemeNames.includes(desktopState.theme.name)
    ? desktopState.theme.name
    : "default";
  customThemeInput.value =
    desktopState.theme.name === "custom" && desktopState.theme.custom
      ? JSON.stringify(desktopState.theme.custom, null, 2)
      : "";
  renderCustomThemeControls();
  renderMcpStatus();
  renderCredentialStorageStatus();
}

async function restoreWorkspaceUiState(): Promise<void> {
  const state = desktopState.workspaceUiState;
  expandedDirectories.clear();
  openEditorTabs.splice(0, openEditorTabs.length);
  activeFile = undefined;
  showingDiff = false;
  if (state) {
    state.expandedDirectories.forEach((path) =>
      expandedDirectories.add(editorPath(path)),
    );
    for (const path of [...expandedDirectories].sort(
      (left, right) => left.split("/").length - right.split("/").length,
    )) {
      await loadDirectoryContents(path).catch(() => undefined);
    }
    for (const saved of state.openEditors) {
      const path = editorPath(saved.path);
      if (openEditorTabs.some((tab) => tab.path === path)) continue;
      openEditorTabs.push({
        path,
        mode: saved.mode,
        state: "loading",
        content: "",
        dirty: false,
        scrollTop: saved.scrollTop,
        revision: 0,
      });
    }
    const savedActiveFile = state.activeFile;
    const restoredActive = savedActiveFile
      ? openEditorTabs.find((tab) => tab.path === editorPath(savedActiveFile))
      : undefined;
    activeFile = restoredActive?.path ?? openEditorTabs.at(-1)?.path;
    showingDiff =
      openEditorTabs.find((tab) => tab.path === activeFile)?.mode === "diff";
  }
  renderFiles();
  renderEditorTabs();
  renderEditorContent(activeEditorTab());
  await Promise.all(openEditorTabs.map(loadEditorTab));
  window.requestAnimationFrame(() => {
    fileTree.scrollTop = state?.fileTreeScrollTop ?? 0;
  });
}

async function applyConfiguration(next: DesktopConfiguration): Promise<void> {
  const returned = await window.trussDesktop.configure(
    next,
    apiKeyInput.value || undefined,
  );
  apiKeyInput.value = "";
  desktopState = returned;
  await discover(next);
  renderRuntime();
  notify(`Using ${next.model}`);
}

function slashQuery():
  | { readonly start: number; readonly query: string }
  | undefined {
  const beforeCursor = chatInput.value.slice(
    0,
    chatInput.selectionStart ?? chatInput.value.length,
  );
  const match = beforeCursor.match(/(?:^|\s)\/([^\s]*)$/);
  if (!match) return undefined;
  return { start: beforeCursor.length - match[1].length - 1, query: match[1] };
}

function fuzzyScore(path: string, query: string): number | undefined {
  const target = path.toLocaleLowerCase();
  const needle = query.toLocaleLowerCase();
  let position = 0;
  let score = 0;
  for (const character of needle) {
    const next = target.indexOf(character, position);
    if (next === -1) return undefined;
    score += next - position;
    position = next + 1;
  }
  return score + (target.includes(needle) ? -30 : 0) + path.length / 1_000;
}

function renderSlashMenu(): void {
  const query = slashQuery();
  if (!query) {
    slashMenu.hidden = true;
    slashResults = [];
    return;
  }
  slashResults = files
    .filter((file) => file.type === "file")
    .flatMap((file) => {
      const score = fuzzyScore(file.path, query.query);
      return score === undefined ? [] : [{ file, score }];
    })
    .sort(
      (left, right) =>
        left.score - right.score ||
        left.file.path.localeCompare(right.file.path),
    )
    .slice(0, 8)
    .map(({ file }) => file);
  if (!slashResults.length) {
    slashMenu.hidden = true;
    return;
  }
  slashIndex = Math.min(slashIndex, slashResults.length - 1);
  slashMenu.replaceChildren(
    ...slashResults.map((file, index) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = `slash-option${index === slashIndex ? " active" : ""}`;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(index === slashIndex));
      option.textContent = file.path;
      option.onmousedown = (event) => {
        event.preventDefault();
        insertSlashFile(file.path);
      };
      return option;
    }),
  );
  slashMenu.hidden = false;
}

function insertSlashFile(path: string): void {
  const query = slashQuery();
  if (!query) return;
  const cursor = chatInput.selectionStart ?? chatInput.value.length;
  chatInput.value = `${chatInput.value.slice(0, query.start)}/${path} ${chatInput.value.slice(cursor)}`;
  const nextCursor = query.start + path.length + 2;
  chatInput.setSelectionRange(nextCursor, nextCursor);
  slashMenu.hidden = true;
  chatInput.focus();
}

function attachedPaths(prompt: string): readonly string[] {
  const available = new Set(
    files.filter((file) => file.type === "file").map((file) => file.path),
  );
  return [
    ...new Set(
      [...prompt.matchAll(/(?:^|\s)\/([^\s]+)/g)]
        .map((match) => match[1].replaceAll("\\", "/"))
        .filter((path) => available.has(path)),
    ),
  ];
}

function attachmentId(): string {
  return `attachment-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function supportsTextAttachment(file: File): boolean {
  return (
    file.type.startsWith("text/") ||
    /\.(?:md|mdx|txt|json|jsonc|ya?ml|toml|ini|cfg|conf|csv|ts|tsx|js|jsx|mjs|cjs|css|html?|xml|svg|py|go|rs|java|php|rb|sh|sql)$/i.test(
      file.name,
    )
  );
}

async function toAttachment(file: File): Promise<ChatAttachment> {
  if (!file.name) throw new Error("The selected file has no name.");
  if (file.size > maxAttachmentBytes)
    throw new Error(`${file.name} exceeds the 4 MB attachment limit.`);
  if (file.type.startsWith("image/")) {
    if (
      !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
        file.type,
      )
    )
      throw new Error(
        `${file.name} uses an unsupported image type. Use PNG, JPEG, WebP, or GIF.`,
      );
    const data = await new Promise<string>((resolveData, reject) => {
      const reader = new FileReader();
      reader.onload = () =>
        typeof reader.result === "string"
          ? resolveData(reader.result)
          : reject(new Error(`Unable to read ${file.name}.`));
      reader.onerror = () => reject(new Error(`Unable to read ${file.name}.`));
      reader.readAsDataURL(file);
    });
    return {
      id: attachmentId(),
      kind: "image",
      name: file.name,
      mediaType: file.type,
      data,
      size: file.size,
    };
  }
  if (!supportsTextAttachment(file))
    throw new Error(
      `${file.name} is not a supported text file. Attach source code, Markdown, JSON, or another text file.`,
    );
  const text = await file.text();
  if (text.includes("\u0000"))
    throw new Error(
      `${file.name} appears to be binary and cannot be attached as text.`,
    );
  return {
    id: attachmentId(),
    kind: "file",
    name: file.name,
    mediaType: file.type || "text/plain",
    text: text.slice(0, maxFileTextCharacters),
    size: file.size,
  };
}

function renderPendingAttachments(): void {
  attachmentList.hidden = pendingAttachments.length === 0;
  attachmentList.replaceChildren(
    ...pendingAttachments.map((attachment) => {
      const item = document.createElement("div");
      item.className = "pending-attachment";
      if (attachment.kind === "image" && attachment.data) {
        const image = document.createElement("img");
        image.src = attachment.data;
        image.alt = "";
        item.append(image);
      }
      const name = document.createElement("span");
      name.textContent = attachment.name;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "x";
      remove.title = `Remove ${attachment.name}`;
      remove.onclick = () => {
        pendingAttachments = pendingAttachments.filter(
          (candidate) => candidate.id !== attachment.id,
        );
        renderPendingAttachments();
      };
      item.append(name, remove);
      return item;
    }),
  );
}

async function addFiles(filesToAdd: Iterable<File>): Promise<void> {
  const selected = [...filesToAdd];
  if (!selected.length) return;
  if (pendingAttachments.length + selected.length > maxAttachmentCount) {
    notify(`Attach up to ${maxAttachmentCount} files at once.`);
    return;
  }
  if (
    pendingAttachments.reduce(
      (total, attachment) => total + attachment.size,
      0,
    ) +
      selected.reduce((total, file) => total + file.size, 0) >
    maxAttachmentTotalBytes
  ) {
    notify("Attachments exceed the 12 MB total limit.");
    return;
  }
  try {
    const attachments = await Promise.all(selected.map(toAttachment));
    pendingAttachments = [...pendingAttachments, ...attachments];
    renderPendingAttachments();
  } catch (error) {
    notify(error instanceof Error ? error.message : String(error));
  }
}

function hideFileContextMenu(): void {
  fileContextMenu.hidden = true;
  fileContextTarget = undefined;
}

function requestWorkspaceEntry(options: {
  readonly title: string;
  readonly description: string;
  readonly initialValue: string;
  readonly confirmLabel: string;
}): Promise<string | undefined> {
  if (resolveFileEntry)
    return Promise.reject(new Error("Finish the current file action first."));
  fileEntryTitle.textContent = options.title;
  fileEntryDescription.textContent = options.description;
  fileEntryInput.value = options.initialValue;
  confirmFileEntry.textContent = options.confirmLabel;
  fileEntryDialog.showModal();
  window.requestAnimationFrame(() => {
    fileEntryInput.focus();
    fileEntryInput.select();
  });
  return new Promise((resolve) => {
    resolveFileEntry = resolve;
  });
}

fileEntryForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!fileEntryInput.value.trim()) {
    fileEntryInput.focus();
    return;
  }
  fileEntryDialog.close("confirm");
});
element<HTMLButtonElement>("cancelFileEntry").onclick = () =>
  fileEntryDialog.close("cancel");
element<HTMLButtonElement>("closeFileEntry").onclick = () =>
  fileEntryDialog.close("cancel");
fileEntryDialog.addEventListener("close", () => {
  const resolve = resolveFileEntry;
  resolveFileEntry = undefined;
  resolve?.(
    fileEntryDialog.returnValue === "confirm"
      ? fileEntryInput.value
      : undefined,
  );
});
cancelConfirm.onclick = () => confirmDialog.close("cancel");
closeConfirm.onclick = () => confirmDialog.close("cancel");
confirmDialog.addEventListener("close", () => {
  const resolve = resolveConfirmation;
  resolveConfirmation = undefined;
  resolve?.(confirmDialog.returnValue === "confirm");
});

function normalizedWorkspaceEntry(value: string): string | undefined {
  const normalized = value.trim().replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || /^[a-z]:/i.test(normalized))
    return undefined;
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === ".."))
    return undefined;
  return normalized;
}

function entryParent(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

function entryName(path: string): string {
  return path.split("/").at(-1) ?? path;
}

function childEntryPath(parent: string, name: string): string | undefined {
  const normalizedName = normalizedWorkspaceEntry(name);
  if (!normalizedName) return undefined;
  return parent ? `${parent}/${normalizedName}` : normalizedName;
}

function removeOpenEditorEntries(path: string, includeChildren: boolean): void {
  const prefix = `${path}/`;
  const removedActive =
    activeFile === path ||
    (includeChildren && Boolean(activeFile?.startsWith(prefix)));
  for (let index = openEditorTabs.length - 1; index >= 0; index -= 1) {
    const tabPath = openEditorTabs[index].path;
    if (tabPath === path || (includeChildren && tabPath.startsWith(prefix)))
      openEditorTabs.splice(index, 1);
  }
  if (!removedActive) {
    renderEditorTabs();
    return;
  }
  const next = openEditorTabs.at(-1);
  activeFile = undefined;
  showingDiff = false;
  if (next) selectEditorTab(next);
  else {
    editorTitle.textContent = "Workspace";
    renderEditorTabs();
    renderEditorContent(undefined);
  }
}

async function refreshWorkspaceAfterFileOperation(): Promise<void> {
  await Promise.all([loadFiles(), refreshGit()]);
  saveWorkspaceUiState();
}

function addFileContextAction(
  label: string,
  action: () => void | Promise<void>,
  options: {
    readonly danger?: boolean;
    readonly separatorBefore?: boolean;
  } = {},
): void {
  if (options.separatorBefore) {
    const separator = document.createElement("div");
    separator.className = "context-separator";
    fileContextMenu.append(separator);
  }
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.setAttribute("role", "menuitem");
  if (options.danger) button.classList.add("danger");
  button.onclick = () => {
    hideFileContextMenu();
    void Promise.resolve(action()).catch((error) =>
      notify(error instanceof Error ? error.message : String(error)),
    );
  };
  fileContextMenu.append(button);
}

async function createWorkspaceEntry(
  kind: "file" | "folder",
  parent: string,
): Promise<void> {
  const name = await requestWorkspaceEntry({
    title: kind === "file" ? "New file" : "New folder",
    description: "Enter a relative path inside the selected workspace folder.",
    initialValue: kind === "file" ? "untitled.txt" : "new-folder",
    confirmLabel: kind === "file" ? "Create file" : "Create folder",
  });
  if (name === undefined) return;
  const path = childEntryPath(parent, name);
  if (!path)
    throw new Error("Use a non-empty relative workspace path without '..'.");
  if (kind === "file") await window.trussDesktop.createWorkspaceFile(path);
  else await window.trussDesktop.createWorkspaceFolder(path);
  const parentPath = entryParent(path);
  if (parentPath) expandedDirectories.add(parentPath);
  await refreshWorkspaceAfterFileOperation();
  notify(`${kind === "file" ? "Created file" : "Created folder"}: ${path}`);
  if (kind === "file") await openFile(path, false);
}

async function renameWorkspaceEntry(target: FileContextTarget): Promise<void> {
  const name = await requestWorkspaceEntry({
    title: "Rename entry",
    description: "Enter a new name in the same workspace folder.",
    initialValue: entryName(target.path),
    confirmLabel: "Rename",
  });
  if (name === undefined) return;
  const nextPath = childEntryPath(entryParent(target.path), name);
  if (!nextPath)
    throw new Error("Use a non-empty name without path traversal.");
  if (nextPath === target.path) return;
  await window.trussDesktop.renameWorkspaceEntry(target.path, nextPath);
  removeOpenEditorEntries(target.path, target.kind === "directory");
  if (target.kind === "directory") {
    const wasExpanded = expandedDirectories.delete(target.path);
    loadedDirectoryContents.delete(target.path);
    if (wasExpanded) expandedDirectories.add(nextPath);
  }
  await refreshWorkspaceAfterFileOperation();
  notify(`Renamed to ${nextPath}`);
  if (target.kind === "file") await openFile(nextPath, false);
}

async function pasteWorkspaceFile(target: FileContextTarget): Promise<void> {
  if (!copiedWorkspaceFile) return;
  const parent =
    target.kind === "directory"
      ? target.path
      : target.kind === "file"
        ? entryParent(target.path)
        : "";
  const sourceName = entryName(copiedWorkspaceFile);
  const extensionIndex = sourceName.lastIndexOf(".");
  const suggested =
    extensionIndex > 0
      ? `${sourceName.slice(0, extensionIndex)} copy${sourceName.slice(extensionIndex)}`
      : `${sourceName} copy`;
  const name = await requestWorkspaceEntry({
    title: "Copy file",
    description:
      "Enter the name for the new copy in the selected workspace folder.",
    initialValue: suggested,
    confirmLabel: "Copy file",
  });
  if (name === undefined) return;
  const destination = childEntryPath(parent, name);
  if (!destination)
    throw new Error("Use a non-empty relative filename without '..'.");
  await window.trussDesktop.copyWorkspaceEntry(
    copiedWorkspaceFile,
    destination,
  );
  await refreshWorkspaceAfterFileOperation();
  notify(`Copied to ${destination}`);
  await openFile(destination, false);
}

async function deleteWorkspaceEntry(target: FileContextTarget): Promise<void> {
  const label =
    target.kind === "directory" ? "folder and all of its contents" : "file";
  if (!(await requestConfirmation({
    title: `Delete ${label}`,
    message: `Delete ${label} "${target.path}"? This cannot be undone.`,
    confirmLabel: "Delete",
    danger: true,
  }))) return;
  await window.trussDesktop.deleteWorkspaceEntry(target.path);
  removeOpenEditorEntries(target.path, target.kind === "directory");
  expandedDirectories.delete(target.path);
  loadedDirectoryContents.delete(target.path);
  if (
    copiedWorkspaceFile === target.path ||
    (target.kind === "directory" &&
      copiedWorkspaceFile?.startsWith(`${target.path}/`))
  )
    copiedWorkspaceFile = undefined;
  await refreshWorkspaceAfterFileOperation();
  notify(`Deleted ${target.path}`);
}

function showFileContextMenu(
  x: number,
  y: number,
  target: FileContextTarget,
): void {
  fileContextTarget = target;
  fileContextMenu.replaceChildren();
  const parent =
    target.kind === "directory"
      ? target.path
      : target.kind === "file"
        ? entryParent(target.path)
        : "";
  addFileContextAction("New File...", () =>
    createWorkspaceEntry("file", parent),
  );
  addFileContextAction("New Folder...", () =>
    createWorkspaceEntry("folder", parent),
  );
  if (target.kind === "file") {
    addFileContextAction("Open", () => openFile(target.path, false), {
      separatorBefore: true,
    });
    addFileContextAction("Copy", () => {
      copiedWorkspaceFile = target.path;
      notify(`Copied ${target.path}`);
    });
    addFileContextAction("Copy Relative Path", async () => {
      await navigator.clipboard.writeText(target.path);
      notify("Copied relative path.");
    });
  }
  if (copiedWorkspaceFile)
    addFileContextAction("Paste File...", () => pasteWorkspaceFile(target), {
      separatorBefore: target.kind !== "file",
    });
  if (target.kind !== "root") {
    addFileContextAction("Rename...", () => renameWorkspaceEntry(target), {
      separatorBefore: !copiedWorkspaceFile && target.kind !== "file",
    });
    addFileContextAction("Reveal in File Manager", () =>
      window.trussDesktop.revealWorkspaceEntry(target.path),
    );
    addFileContextAction("Delete...", () => deleteWorkspaceEntry(target), {
      danger: true,
      separatorBefore: true,
    });
  }
  addFileContextAction("Refresh Explorer", refreshWorkspaceAfterFileOperation, {
    separatorBefore: target.kind === "root",
  });
  fileContextMenu.hidden = false;
  const bounds = fileContextMenu.getBoundingClientRect();
  fileContextMenu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8))}px`;
  fileContextMenu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8))}px`;
}

function toolActivityView(
  conversationId: string,
  activities: readonly ToolActivity[],
): HTMLElement {
  const trace = document.createElement("details");
  trace.className = "tool-activity";
  trace.open = toolActivityExpandedByConversation.get(conversationId) ?? true;
  trace.addEventListener("toggle", () =>
    toolActivityExpandedByConversation.set(conversationId, trace.open),
  );
  const summary = document.createElement("summary");
  const running = activities.find((activity) => activity.status === "running");
  const toolCallCount = activities.filter(
    (activity) => activity.status !== "progress",
  ).length;
  summary.textContent = running
    ? `Working: ${running.tool}`
    : `Activity: ${toolCallCount} tool call${toolCallCount === 1 ? "" : "s"}`;
  const list = document.createElement("div");
  list.className = "tool-activity-list";
  for (const activity of activities) {
    const row = document.createElement("div");
    row.className = `tool-activity-row ${activity.status}`;
    row.textContent =
      activity.status === "progress"
        ? activity.tool
        : activity.status === "running"
          ? `${activity.tool} running`
          : activity.status === "failed"
            ? `${activity.tool} failed${activity.detail ? `: ${activity.detail}` : ""}`
            : `${activity.tool} completed`;
    if (activity.detail) row.title = activity.detail;
    list.append(row);
  }
  trace.append(summary, list);
  return trace;
}

function pastedFileName(mimeType: string): string {
  const extension =
    mimeType === "image/jpeg"
      ? "jpg"
      : mimeType === "image/webp"
        ? "webp"
        : mimeType === "image/gif"
          ? "gif"
          : "png";
  return `pasted-image-${Date.now()}.${extension}`;
}

async function sendChat(): Promise<void> {
  const prompt =
    chatInput.value.trim() ||
    (pendingAttachments.length ? "Review the attached files." : "");
  if (!prompt || busy) return;
  if (
    configuration().mode === "chat" &&
    isDirectWorkspaceChangeRequest(prompt)
  ) {
    try {
      await applyConfiguration({ ...configuration(), mode: "edit" });
      notify("Switched to Agent mode for this workspace change.");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
      return;
    }
  }
  if (!configuration().model) {
    openSettings();
    notify("Choose a local model first.");
    return;
  }
  const conversation = ensureConversation();
  const history = conversation.messages;
  const attachments = pendingAttachments;
  const userMessage: DesktopMessage = {
    role: "user",
    content: prompt,
    ...(attachments.length ? { attachments } : {}),
  };
  const assistantMessage: DesktopMessage = { role: "assistant", content: "" };
  const title =
    conversation.title === "New conversation"
      ? prompt.replace(/\s+/g, " ").slice(0, 42) || conversation.title
      : conversation.title;
  updateConversation(conversation.id, (current) => ({
    ...current,
    title,
    messages: [...current.messages, userMessage, assistantMessage],
    updatedAt: new Date().toISOString(),
  }));
  desktopState = { ...desktopState, activeConversationId: conversation.id };
  chatInput.value = "";
  pendingAttachments = [];
  attachmentInput.value = "";
  renderPendingAttachments();
  renderConversations();
  renderChat();
  renderRuntime();
  saveConversations();
  try {
    runningConversationId = conversation.id;
    setBusy(true);
    await window.trussDesktop.sendChat({
      prompt,
      conversationId: conversation.id,
      history,
      attachments,
      activeFilePath: activeWorkspaceFilePath(),
      attachedPaths: attachedPaths(prompt),
      openFilePaths: openEditorTabs
        .filter((tab) => tab.mode !== "settings")
        .map((tab) => tab.path),
    });
  } catch (error) {
    updateConversation(conversation.id, (current) => ({
      ...current,
      messages: [
        ...current.messages.slice(0, -1),
        {
          role: "assistant",
          content: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    }));
    setBusy(false);
    renderChat();
  }
}

function appendTerminal(text: string): void {
  terminalOutput.textContent = `${terminalOutput.textContent}${text}`.slice(
    -50_000,
  );
  terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

function handleEvent(message: DesktopEvent): void {
  if (message.type === "agents") {
    applyAgentsSnapshot(message.snapshot);
    return;
  }
  if (message.type === "update") {
    renderUpdate(message);
    return;
  }
  if (message.type === "file-context-open") {
    showFileContextMenu(message.x, message.y, message.target);
    return;
  }
  if (message.type === "chat-start") {
    runningConversationId = message.conversationId;
    setToolActivity(message.conversationId, []);
    toolActivityExpandedByConversation.set(message.conversationId, true);
    updateConversation(message.conversationId, (current) => ({
      ...current,
      lastRun: { status: "running", modifiedFiles: [] },
    }));
    setBusy(true);
    renderChat();
    return;
  }
  if (message.type === "chat-end") {
    const conversation = conversationById(message.conversationId);
    if (conversation && conversation.lastRun && !conversation.lastRun.usage) {
      updateConversation(conversation.id, (current) => ({
        ...current,
        lastRun: {
          ...current.lastRun!,
          usage: estimatedConversationUsage(current),
        },
      }));
      saveConversations();
    }
    if (message.conversationId === runningConversationId) {
      runningConversationId = undefined;
      setBusy(false);
    }
    renderChat();
    return;
  }
  if (message.type === "chat-error") {
    const conversation = conversationById(message.conversationId);
    if (conversation)
      updateConversation(conversation.id, (current) => {
        const last = current.messages.at(-1);
        const messages =
          last?.role === "assistant" && !last.content.trim()
            ? [
                ...current.messages.slice(0, -1),
                {
                  role: "assistant" as const,
                  content: `The run stopped before completion: ${message.message}`,
                },
              ]
            : current.messages;
        return {
          ...current,
          messages,
          lastRun: {
            status: "failed",
            modifiedFiles: [],
            completedAt: new Date().toISOString(),
          },
          updatedAt: new Date().toISOString(),
        };
      });
    if (message.conversationId === runningConversationId) {
      runningConversationId = undefined;
      setBusy(false);
    }
    renderChat();
    saveConversations();
    return;
  }
  if (message.type === "terminal-output") {
    appendTerminal(message.text);
    return;
  }
  if (message.type === "approval") {
    const approval = document.createElement("div");
    approval.className = "tool-message";
    approval.textContent = `Allow ${message.tool} ${JSON.stringify(message.input)}?`;
    const actions = document.createElement("div");
    actions.className = "approval-actions";
    const allow = document.createElement("button");
    allow.textContent = "Allow";
    const allowAll = document.createElement("button");
    allowAll.textContent = "Allow all this session";
    const deny = document.createElement("button");
    deny.textContent = "Deny";
    allow.onclick = () => {
      void window.trussDesktop.resolveApproval(message.callId, true);
      approval.textContent = `Allowed ${message.tool}`;
    };
    allowAll.onclick = () => {
      void window.trussDesktop.resolveApproval(message.callId, true, true);
      approval.textContent = "Allowed all tools for this session";
    };
    deny.onclick = () => {
      void window.trussDesktop.resolveApproval(message.callId, false);
      approval.textContent = `Denied ${message.tool}`;
    };
    actions.append(allow, allowAll, deny);
    approval.append(actions);
    chatMessages.append(approval);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return;
  }
  if (message.type !== "agent") return;
  const event = message.event;
  const conversation =
    conversationById(message.conversationId) ??
    conversationById(runningConversationId);
  if (event.type === "plan_updated" && event.plan) {
    activePlan = event.plan;
    renderPlan();
    return;
  }
  if (event.type === "usage" && event.usage && conversation) {
    updateConversation(conversation.id, (current) => ({
      ...current,
      lastRun: current.lastRun
        ? { ...current.lastRun, usage: addUsage(current.lastRun.usage, event.usage!) }
        : current.lastRun,
      updatedAt: new Date().toISOString(),
    }));
    saveConversations();
    renderChat();
    renderRuntime();
    return;
  }
  if (event.type === "run_completed") {
    if (conversation) {
      updateConversation(conversation.id, (current) => ({
        ...current,
        lastRun: {
          status: "completed",
          modifiedFiles: event.modifiedFiles ?? [],
          completedAt: new Date().toISOString(),
        },
        updatedAt: new Date().toISOString(),
      }));
      saveConversations();
      renderChat();
    }
    const modified = new Set(
      (event.modifiedFiles ?? []).map((path) => path.replaceAll("\\", "/")),
    );
    for (const tab of openEditorTabs) {
      if (!modified.has(tab.path.replaceAll("\\", "/"))) continue;
      if (tab.dirty) {
        notify(`${tab.path} changed on disk while you have unsaved edits.`);
        continue;
      }
      void loadEditorTab(tab);
    }
    if (centerView === "preview" && browserView.getURL() !== "about:blank")
      browserView.reload();
    return;
  }
  if (event.type === "text_delta") {
    if (!conversation) return;
    updateConversation(conversation.id, (current) => {
      const last = current.messages.at(-1);
      if (!last || last.role !== "assistant") return current;
      return {
        ...current,
        messages: [
          ...current.messages.slice(0, -1),
          { role: "assistant", content: last.content + (event.text ?? "") },
        ],
        updatedAt: new Date().toISOString(),
      };
    });
    if (!streamStartedAt) streamStartedAt = performance.now();
    streamedTextCharacters += (event.text ?? "").length;
    agentActivity = "Generating";
    if (conversation.id === desktopState.activeConversationId) renderChat();
    renderRuntime();
    saveConversations();
  }
  if (event.type === "progress_delta") {
    if (!conversation) return;
    const note = event.text ?? "";
    if (!note) return;
    const activities = toolActivityByConversation.get(conversation.id) ?? [];
    const previous = activities.at(-1);
    const nextActivities: ToolActivity[] =
      previous?.status === "progress"
        ? [
            ...activities.slice(0, -1),
            { ...previous, tool: `${previous.tool}${note}` },
          ]
        : [
            ...activities,
            { callId: createId(), tool: note, status: "progress" },
          ];
    setToolActivity(conversation.id, nextActivities);
    agentActivity = nextActivities.at(-1)?.tool.trim() || "Thinking";
    if (conversation.id === desktopState.activeConversationId) renderChat();
    renderRuntime();
    return;
  }
  if (event.type === "tool_call_requested") {
    agentActivity = `Running ${event.tool ?? "tool"}`;
    renderRuntime();
    if (conversation) {
      const activities = toolActivityByConversation.get(conversation.id) ?? [];
      setToolActivity(conversation.id, [
        ...activities,
        {
          callId: event.callId ?? createId(),
          tool: event.tool ?? "unknown",
          status: "running",
        },
      ]);
      if (conversation.id === desktopState.activeConversationId) renderChat();
    }
  }
  if (event.type === "tool_completed") {
    agentActivity = "Thinking";
    renderRuntime();
    const tool = event.tool ?? "tool";
    const result = event.result?.content ?? "";
    if (conversation) {
      const activities = toolActivityByConversation.get(conversation.id) ?? [];
      const detail = result.replace(/\s+/g, " ").trim().slice(0, 320);
      setToolActivity(
        conversation.id,
        activities.map((activity) =>
          activity.callId === event.callId
            ? {
                ...activity,
                status: event.result?.isError ? "failed" : "completed",
                detail,
              }
            : activity,
        ),
      );
      if (conversation.id === desktopState.activeConversationId) renderChat();
    }
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function bindPaneResize(
  id: string,
  axis: "x" | "y",
  createMove: () => (delta: number) => void,
): void {
  const splitter = element<HTMLDivElement>(id);
  splitter.tabIndex = 0;
  splitter.setAttribute(
    "aria-orientation",
    axis === "x" ? "vertical" : "horizontal",
  );
  splitter.addEventListener("pointerdown", (down) => {
    down.preventDefault();
    const start = axis === "x" ? down.clientX : down.clientY;
    const move = createMove();
    document.body.classList.add("resizing");
    splitter.setPointerCapture(down.pointerId);
    const onMove = (event: PointerEvent): void =>
      move((axis === "x" ? event.clientX : event.clientY) - start);
    const onEnd = (): void => {
      document.body.classList.remove("resizing");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
  });
  splitter.addEventListener("keydown", (event) => {
    const increase =
      axis === "x" ? event.key === "ArrowRight" : event.key === "ArrowDown";
    const decrease =
      axis === "x" ? event.key === "ArrowLeft" : event.key === "ArrowUp";
    if (!increase && !decrease) return;
    event.preventDefault();
    createMove()(
      increase ? (event.shiftKey ? 48 : 12) : event.shiftKey ? -48 : -12,
    );
  });
}

bindPaneResize("sidebarSplitter", "x", () => {
  const initial = sidebar.getBoundingClientRect().width;
  return (delta) =>
    workbench.style.setProperty(
      "--sidebar-width",
      `${clamp(initial + delta, 190, 520)}px`,
    );
});
bindPaneResize("chatSplitter", "x", () => {
  const initial =
    document.querySelector<HTMLElement>(".chat-area")?.getBoundingClientRect()
      .width ?? 390;
  return (delta) =>
    workbench.style.setProperty(
      "--chat-width",
      `${clamp(initial - delta, 330, 680)}px`,
    );
});
bindPaneResize("gitSplitter", "y", () => {
  if (gitCollapsed) setGitCollapsed(false);
  const initial = sidebarTracks();
  return (delta) => {
    const applied = clamp(delta, 160 - initial.git, initial.files - 110);
    gitPanelHeight = initial.git + applied;
    applySidebarTracks(
      gitPanelHeight,
      initial.files - applied,
      initial.history,
    );
  };
});
bindPaneResize("historySplitter", "y", () => {
  const initial = sidebarTracks();
  return (delta) => {
    const applied = clamp(delta, 110 - initial.files, initial.history - 110);
    applySidebarTracks(
      initial.git,
      initial.files + applied,
      initial.history - applied,
    );
  };
});
element<HTMLDivElement>("gitSplitter").ondblclick = resetSidebarTracks;
element<HTMLDivElement>("historySplitter").ondblclick = resetSidebarTracks;
bindPaneResize("terminalSplitter", "y", () => {
  const initial = terminal.getBoundingClientRect().height;
  const adjacent = centerSurface.getBoundingClientRect().height;
  return (delta) => {
    const applied = clamp(delta, 160 - adjacent, initial - 120);
    editorArea.style.setProperty("--terminal-height", `${initial - applied}px`);
  };
});

element<HTMLButtonElement>("chooseWorkspace").onclick = async () => {
  const next = await window.trussDesktop.chooseWorkspace();
  if (!next) return;
  desktopState = next;
  activeFile = undefined;
  showingDiff = false;
  openEditorTabs.splice(0, openEditorTabs.length);
  expandedDirectories.clear();
  loadedDirectoryContents.clear();
  setCenterView("editor");
  editorTitle.textContent = "Workspace";
  renderEditorTabs();
  renderEditorContent(undefined);
  await Promise.all([
    loadFiles(),
    refreshGit(),
    window.trussDesktop.getPlan().then((plan) => {
      activePlan = plan;
      renderPlan();
    }),
  ]);
  await restoreWorkspaceUiState();
  renderConversations();
  renderChat();
  renderRuntime();
};
element<HTMLButtonElement>("refreshModels").onclick = () => {
  void window.trussDesktop
    .refreshLocalModel()
    .then(async (returned) => {
      desktopState = returned;
      populateSettings();
      await discover(returned.configuration);
      renderRuntime();
      notify(
        `Detected ${returned.configuration?.provider ?? "local provider"} / ${returned.configuration?.model ?? "model"}`,
      );
    })
    .catch((error) =>
      notify(error instanceof Error ? error.message : String(error)),
    );
};
element<HTMLButtonElement>("refreshFiles").onclick = () => void loadFiles();
fileSearch.oninput = () => {
  fileSearchQuery = fileSearch.value;
  renderFiles();
};
document.addEventListener("pointerdown", (event) => {
  // Do not let a secondary click close the menu before its contextmenu event
  // can replace it. This matters on Linux window managers that dispatch those
  // pointer events in a different order from Chromium on other platforms.
  if (
    event.button === 0 &&
    !fileContextMenu.hidden &&
    !fileContextMenu.contains(event.target as Node)
  )
    hideFileContextMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !fileContextMenu.hidden) hideFileContextMenu();
});
fileTree.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  const element = event.target;
  const row =
    element instanceof Element
      ? element.closest<HTMLElement>(".tree-row")
      : null;
  const button = row?.querySelector<HTMLButtonElement>("button[data-path]");
  const target: FileContextTarget =
    !row || !button?.dataset.path
      ? { kind: "root", path: "" }
      : {
          kind: row.classList.contains("directory") ? "directory" : "file",
          path: button.dataset.path,
        };
  showFileContextMenu(event.clientX, event.clientY, target);
});
fileTree.addEventListener("scroll", saveWorkspaceUiState, { passive: true });
editor.addEventListener(
  "scroll",
  () => {
    const tab = activeEditorTab();
    if (tab && !editor.querySelector("textarea"))
      tab.scrollTop = editor.scrollTop;
    saveWorkspaceUiState();
  },
  { passive: true },
);
fileSearch.onkeydown = (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    fileSearch.value = "";
    fileSearchQuery = "";
    renderFiles();
  }
};
clearFileSearch.onclick = () => {
  fileSearch.value = "";
  fileSearchQuery = "";
  renderFiles();
  fileSearch.focus();
};
element<HTMLButtonElement>("refreshGit").onclick = () => void refreshGit();
element<HTMLButtonElement>("toggleGit").onclick = () =>
  setGitCollapsed(!gitCollapsed);
element<HTMLButtonElement>("stageAll").onclick = () => {
  const staged = gitStatus.files.filter(
    (file) => file.indexStatus !== " " && file.indexStatus !== "?",
  );
  if (staged.length) {
    void runGitAction("unstage", () =>
      window.trussDesktop.gitUnstage(staged.map((file) => file.path)),
    );
    return;
  }
  if (!gitStatus.files.length) {
    notify("No changed files to stage.");
    return;
  }
  void runGitAction("stage", () =>
    window.trussDesktop.gitStage(gitStatus.files.map((file) => file.path)),
  );
};
element<HTMLButtonElement>("discardAll").onclick = () => {
  if (!gitStatus.files.length) {
    notify("No uncommitted changes to discard.");
    return;
  }
  void requestConfirmation({
    title: "Discard workspace changes",
    message:
      "Discard every uncommitted change in this workspace? This also removes untracked files and cannot be undone.",
    confirmLabel: "Discard all",
    danger: true,
  }).then((confirmed) => {
    if (confirmed)
      void runGitAction("discard all", () =>
        window.trussDesktop.gitDiscard(gitStatus.files.map((file) => file.path)),
      );
  });
};
pullGit.onclick = () =>
  void runGitAction("pull", () => window.trussDesktop.gitPull());
pushGit.onclick = () => {
  if (!gitStatus.pushRemote) {
    notify("No push remote configured. Add one with: git remote add origin <url>");
    return;
  }
  void runGitAction("push", () => window.trussDesktop.gitPush());
};
generateCommitMessage.onclick = () => {
  if (!configuration().model) {
    openSettings();
    notify("Choose a local model first.");
    return;
  }
  generateCommitMessage.disabled = true;
  generateCommitMessage.textContent = "Generating...";
  void window.trussDesktop
    .gitGenerateCommitMessage()
    .then((message) => {
      commitMessage.value = message;
      commitMessage.focus();
      notify("Commit message generated. Review it, then commit.");
    })
    .catch((error) => {
      const detail = error instanceof Error ? error.message : String(error);
      appendTerminal(`\n[commit message generation failed] ${detail}\n`);
      notify(detail);
    })
    .finally(() => {
      generateCommitMessage.disabled = false;
      generateCommitMessage.textContent = "Generate";
    });
};
element<HTMLFormElement>("commitForm").onsubmit = (event) => {
  event.preventDefault();
  const message = commitMessage.value.trim();
  if (!message) {
    notify("Enter a commit message.");
    return;
  }
  void runGitAction("commit", async () => {
    const output = await window.trussDesktop.gitCommit(message);
    commitMessage.value = "";
    return output;
  });
};
element<HTMLButtonElement>("newChat").onclick = () => {
  cancelActiveRunForNavigation();
  createConversation();
  finishConversationNavigation();
};
fileDiffToggle.onclick = () => {
  const path = activeWorkspaceFilePath();
  setCenterView("editor");
  if (path) void openFile(path, !showingDiff, true);
};
formatFileButton.onclick = () => void formatActiveFile();
editorTabsElement.addEventListener(
  "wheel",
  (event) => {
    if (event.ctrlKey || event.defaultPrevented) return;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    event.preventDefault();
    editorTabsElement.scrollBy({ left: event.deltaY, behavior: "smooth" });
  },
  { passive: false },
);
window.addEventListener(
  "wheel",
  (event) => {
    if (!event.ctrlKey || event.deltaY === 0) return;
    event.preventDefault();
    const now = Date.now();
    if (now - lastZoomWheelAt < 140) return;
    lastZoomWheelAt = now;
    const direction: -1 | 1 = event.deltaY < 0 ? 1 : -1;
    void window.trussDesktop
      .adjustZoom(direction)
      .then((zoomFactor) => {
        desktopState = { ...desktopState, zoomFactor };
        notify(`Zoom: ${Math.round(zoomFactor * 100)}%`);
      })
      .catch((error: unknown) =>
        notify(error instanceof Error ? error.message : String(error)),
      );
  },
  { passive: false, capture: true },
);
element<HTMLButtonElement>("settingsButton").onclick = openSettings;
element<HTMLButtonElement>("openChat").onclick = () => setCenterView("chat");
toggleChat.onclick = () => setChatCollapsed(!chatCollapsed);
toggleChatDock.onclick = () => setChatDocked(!chatDocked);
element<HTMLButtonElement>("dialogRefresh").onclick = () => {
  const provider = providerSelect.value as "ollama" | "openai-compatible";
  void discover({ provider, baseUrl: baseUrlInput.value });
};
element<HTMLButtonElement>("applySettings").onclick = (event) => {
  event.preventDefault();
  try {
    const next = settingsConfiguration();
    void applyConfiguration(next)
      .then(() =>
        window.trussDesktop.configureUpdates({
          checkOnLaunch: checkUpdatesOnLaunch.checked,
          autoDownload: autoDownloadUpdates.checked,
        }),
      )
      .then((returned) => {
        desktopState = returned;
        notify("Settings applied.");
      })
      .catch((error) =>
        notify(error instanceof Error ? error.message : String(error)),
      );
  } catch (error) {
    notify(error instanceof Error ? error.message : String(error));
  }
};
clearApiKey.onclick = () => {
  void window.trussDesktop
    .clearCredential(
      byokProviderSelect.value as DesktopProvider,
      selectedProviderAccountId,
    )
    .then(() => {
      apiKeyInput.value = "";
      notify("Stored account key removed.");
    })
    .catch((error: unknown) =>
      notify(error instanceof Error ? error.message : String(error)),
    );
};
testProviderConnection.onclick = () => {
  let next: DesktopConfiguration;
  try {
    next = providerConnectionConfiguration();
  } catch (error) {
    notify(error instanceof Error ? error.message : String(error));
    return;
  }
  testProviderConnection.disabled = true;
  testProviderConnection.textContent = "Testing...";
  providerConnectionResult.hidden = false;
  providerConnectionResult.className = "provider-connection-result";
  providerConnectionResult.textContent = "Contacting the provider...";
  void window.trussDesktop
    .testProviderConnection(next, apiKeyInput.value || undefined)
    .then((result) => {
      providerConnectionResult.className = `provider-connection-result ${
        result.status === "connected" ? "connected" : "failed"
      }`;
      providerConnectionResult.textContent = result.message;
    })
    .catch(() => {
      providerConnectionResult.className = "provider-connection-result failed";
      providerConnectionResult.textContent =
        "The connection test could not start. Check the provider settings and try again.";
    })
    .finally(() => {
      testProviderConnection.disabled = false;
      testProviderConnection.textContent = "Test connection";
    });
};
newProviderAccount.onclick = () => {
  creatingProviderAccount = true;
  selectedProviderAccountId = undefined;
  apiKeyInput.value = "";
  renderProviderAccounts();
  providerAccountLabel.focus();
};
providerAccountSelect.onchange = () => {
  creatingProviderAccount = false;
  selectedProviderAccountId = providerAccountSelect.value || undefined;
  apiKeyInput.value = "";
  byokModels = [];
  renderByokModels();
  renderProviderAccounts(selectedProviderAccountId);
};
saveProviderAccount.onclick = () => {
  const provider = byokProviderSelect.value as DesktopProvider;
  const label = providerAccountLabel.value.trim();
  const apiKey = apiKeyInput.value.trim();
  if (!label) {
    notify("Enter an account label first.");
    providerAccountLabel.focus();
    return;
  }
  if (!apiKey) {
    notify("Enter the provider API key to save this account.");
    apiKeyInput.focus();
    return;
  }
  saveProviderAccount.disabled = true;
  const previousAccountIds = new Set(
    providerAccountsFor(provider).map((account) => account.id),
  );
  void window.trussDesktop
    .saveProviderAccount(
      {
        id: creatingProviderAccount ? undefined : selectedProviderAccountId,
        providerId: provider,
        label,
        authMethod: "api-key",
      },
      apiKey,
    )
    .then((returned) => {
      desktopState = returned;
      creatingProviderAccount = false;
      const saved = providerAccountsFor(provider).find(
        (account) =>
          account.id === selectedProviderAccountId ||
          (!previousAccountIds.has(account.id) && account.label === label),
      );
      selectedProviderAccountId = saved?.id ?? selectedProviderAccountId;
      apiKeyInput.value = "";
      renderProviderAccounts(selectedProviderAccountId);
      notify("Provider account saved. Apply settings to use it.");
    })
    .catch((error: unknown) =>
      notify(error instanceof Error ? error.message : String(error)),
    )
    .finally(() => {
      saveProviderAccount.disabled = false;
    });
};
deleteProviderAccount.onclick = () => {
  const accountId = selectedProviderAccountId;
  if (!accountId) return;
  deleteProviderAccount.disabled = true;
  void window.trussDesktop
    .deleteProviderAccount(accountId)
    .then((returned) => {
      desktopState = returned;
      selectedProviderAccountId = undefined;
      creatingProviderAccount = false;
      apiKeyInput.value = "";
      renderProviderAccounts();
      notify("Provider account deleted.");
    })
    .catch((error: unknown) =>
      notify(error instanceof Error ? error.message : String(error)),
    )
    .finally(() => {
      deleteProviderAccount.disabled = false;
    });
};
element<HTMLButtonElement>("addMcpServer").onclick = () => openMcpEditor();
element<HTMLButtonElement>("cancelMcpServer").onclick = closeMcpEditor;
element<HTMLButtonElement>("saveMcpServer").onclick = () => {
  const name = (editingMcpName ?? mcpNameInput.value).trim();
  const command = mcpCommandInput.value.trim();
  if (!name || !command) {
    notify("Enter a name and command for the MCP server.");
    return;
  }
  if (!editingMcpName && mcpDraft[name]) {
    notify(`An MCP server named ${name} already exists.`);
    return;
  }
  const previous = editingMcpName ? mcpDraft[editingMcpName] : undefined;
  mcpDraft = {
    ...mcpDraft,
    [name]: {
      command,
      args: mcpArgsInput.value
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean),
      cwd: mcpCwdInput.value.trim() || undefined,
      enabled: mcpEnabledInput.checked,
      readOnly: mcpReadOnlyInput.checked,
      ...(previous?.env ? { env: previous.env } : {}),
    },
  };
  testedMcpStatuses.delete(name);
  syncMcpAdvancedJson();
  closeMcpEditor();
  renderMcpManager();
};
mcpServerList.onclick = (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "button[data-mcp-action]",
  );
  const name = button?.dataset.mcpName;
  const action = button?.dataset.mcpAction;
  if (!button || !name || !action || !mcpDraft[name]) return;
  if (action === "edit") {
    openMcpEditor(name);
    return;
  }
  if (action === "toggle") {
    mcpDraft = {
      ...mcpDraft,
      [name]: { ...mcpDraft[name], enabled: mcpDraft[name].enabled === false },
    };
    testedMcpStatuses.delete(name);
    syncMcpAdvancedJson();
    renderMcpManager();
    return;
  }
  if (action === "remove") {
    const { [name]: _removed, ...remaining } = mcpDraft;
    mcpDraft = remaining;
    testedMcpStatuses.delete(name);
    syncMcpAdvancedJson();
    if (editingMcpName === name) closeMcpEditor();
    renderMcpManager();
    return;
  }
  if (action === "test") {
    button.disabled = true;
    testedMcpStatuses.set(name, { name, state: "connecting", toolCount: 0 });
    renderMcpManager();
    void window.trussDesktop
      .testMcpServer(name, mcpDraft[name])
      .then((status) => testedMcpStatuses.set(name, status))
      .catch(() =>
        testedMcpStatuses.set(name, {
          name,
          state: "failed",
          toolCount: 0,
          error: "The MCP server test could not start.",
        }),
      )
      .finally(renderMcpManager);
  }
};
mcpServersInput.onchange = () => {
  try {
    mcpDraft = mcpConfigurationsFromAdvancedJson();
    testedMcpStatuses.clear();
    closeMcpEditor();
    renderMcpManager();
  } catch (error) {
    notify(error instanceof Error ? error.message : String(error));
  }
};
for (const input of [
  byokProviderSelect,
  byokBaseUrl,
  byokModelInput,
  apiKeyInput,
]) {
  input.addEventListener("input", clearProviderConnectionResult);
  input.addEventListener("change", clearProviderConnectionResult);
}
byokModelSelect.onchange = () => {
  if (byokModelSelect.value) byokModelInput.value = byokModelSelect.value;
  clearProviderConnectionResult();
};
themeSelect.onchange = () => {
  renderCustomThemeControls();
  if (themeSelect.value === "custom") {
    applyTheme({
      name: "custom",
      custom:
        desktopState.theme.name === "custom" ? desktopState.theme.custom : {},
    });
    return;
  }
  void saveTheme({
    name: themeSelect.value as Exclude<
      DesktopThemePreference["name"],
      "custom"
    >,
  }).catch((error: unknown) =>
    notify(error instanceof Error ? error.message : String(error)),
  );
};
customThemeInput.oninput = () => {
  try {
    applyTheme({ name: "custom", custom: parseCustomTheme() });
  } catch {
    /* Keep the previous preview until the JSON is valid. */
  }
};
saveCustomTheme.onclick = () => {
  try {
    void saveTheme({ name: "custom", custom: parseCustomTheme() }).catch(
      (error: unknown) =>
        notify(error instanceof Error ? error.message : String(error)),
    );
  } catch (error) {
    notify(error instanceof Error ? error.message : String(error));
  }
};
checkUpdates.onclick = () =>
  void window.trussDesktop.checkForUpdates().catch((error) =>
    renderUpdate({
      type: "update",
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    }),
  );
downloadUpdate.onclick = () =>
  void window.trussDesktop.downloadUpdate().catch((error) =>
    renderUpdate({
      type: "update",
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    }),
  );
installUpdate.onclick = () => {
  void window.trussDesktop.installUpdate().catch((error) =>
    renderUpdate({
      type: "update",
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    }),
  );
};
endpointSelect.onchange = () => {
  if (!endpointSelect.value) return;
  const selected = JSON.parse(endpointSelect.value) as DesktopEndpoint;
  providerSelect.value = selected.kind;
  baseUrlInput.value = selected.baseUrl;
  void discover({ provider: selected.kind, baseUrl: selected.baseUrl });
};
providerSelect.onchange = () => {
  if (!isLocalProvider(configuration().provider))
    baseUrlInput.value =
      providerSelect.value === "ollama"
        ? "http://127.0.0.1:11434"
        : "http://127.0.0.1:1234/v1";
};
byokProviderSelect.onchange = () => {
  byokBaseUrl.value = byokBaseUrlForSelectedProvider();
  creatingProviderAccount = false;
  selectedProviderAccountId = undefined;
  apiKeyInput.value = "";
  byokModels = [];
  renderByokModels();
  renderProviderAccounts();
};
discoverByokModels.onclick = () => void discoverByokModelList();
document
  .querySelectorAll<HTMLButtonElement>("[data-settings-tab]")
  .forEach((button) => {
    button.onclick = () =>
      setSettingsTab(
        button.dataset.settingsTab === "byok"
          ? "byok"
          : button.dataset.settingsTab === "other"
            ? "other"
            : "local",
      );
  });
quickModel.onchange = () => {
  const next = quickModel.value;
  if (!next || next === configuration().model) return;
  const current = configuration();
  void applyConfiguration({
    ...current,
    model: next,
    contextWindow: isLocalProvider(current.provider)
      ? current.contextWindow
      : selectedModelContextWindow(next) ?? 8_192,
    modelContextWindow: isLocalProvider(current.provider)
      ? undefined
      : selectedModelContextWindow(next),
  }).catch((error) =>
    notify(error instanceof Error ? error.message : String(error)),
  );
};
document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach(
  (button) =>
    (button.onclick = () =>
      void applyConfiguration({
        ...configuration(),
        mode: button.dataset.mode as DesktopConfiguration["mode"],
      }).catch((error) =>
        notify(error instanceof Error ? error.message : String(error)),
      )),
);
element<HTMLFormElement>("chatForm").onsubmit = (event) => {
  event.preventDefault();
  void sendChat();
};
addAttachment.onclick = () => attachmentInput.click();
attachmentInput.onchange = () => {
  void addFiles(Array.from(attachmentInput.files ?? []));
};
chatInput
  .closest<HTMLFormElement>("form")
  ?.addEventListener("dragover", (event) => {
    event.preventDefault();
  });
chatInput
  .closest<HTMLFormElement>("form")
  ?.addEventListener("drop", (event) => {
    event.preventDefault();
    void addFiles(Array.from(event.dataTransfer?.files ?? []));
  });
chatInput.oninput = () => {
  slashIndex = 0;
  renderSlashMenu();
};
chatInput.addEventListener("paste", (event) => {
  const clipboard = event.clipboardData;
  if (!clipboard) return;
  const imageItem = Array.from(clipboard.items).find((item) =>
    item.type.startsWith("image/"),
  );
  if (imageItem) {
    const image = imageItem.getAsFile();
    if (!image) return;
    event.preventDefault();
    const namedImage = image.name
      ? image
      : new File([image], pastedFileName(image.type), { type: image.type });
    void addFiles([namedImage]);
    return;
  }
  const text = clipboard.getData("text/plain");
  if (text.length < longPasteAttachmentThreshold) return;
  event.preventDefault();
  const attachment = new File([text], `pasted-text-${Date.now()}.txt`, {
    type: "text/plain",
  });
  void addFiles([attachment]);
});
chatInput.onkeydown = (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    void sendChat();
    return;
  }
  if (slashMenu.hidden || !slashResults.length) return;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    slashIndex = (slashIndex + 1) % slashResults.length;
    renderSlashMenu();
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    slashIndex = (slashIndex - 1 + slashResults.length) % slashResults.length;
    renderSlashMenu();
  }
  if (
    (event.key === "Enter" || event.key === "Tab") &&
    slashResults[slashIndex]
  ) {
    event.preventDefault();
    insertSlashFile(slashResults[slashIndex].path);
  }
  if (event.key === "Escape") {
    slashMenu.hidden = true;
  }
};
cancelChatButton.onclick = () => void window.trussDesktop.stopChat();
element<HTMLFormElement>("terminalForm").onsubmit = (event) => {
  event.preventDefault();
  const input = element<HTMLInputElement>("terminalInput");
  const command = input.value.trim();
  if (!command) return;
  input.value = "";
  appendTerminal(`\n> ${command}\n`);
  void window.trussDesktop.runTerminal(command);
};
connectTrussGo.onclick = () =>
  void window.trussDesktop
    .connectTrussGo()
    .then((pairing) => {
      trussGoQr.src = pairing.qrDataUrl;
      trussGoWorkspace.textContent = pairing.workspaceName;
      trussGoDialog.showModal();
    })
    .catch((error: unknown) =>
      notify(error instanceof Error ? error.message : String(error)),
    );
element<HTMLButtonElement>("closeTrussGo").onclick = () =>
  trussGoDialog.close();
element<HTMLButtonElement>("disconnectTrussGo").onclick = () =>
  void window.trussDesktop
    .disconnectTrussGo()
    .then(() => trussGoDialog.close());
document
  .querySelectorAll<HTMLButtonElement>("[data-center-view]")
  .forEach((button) => {
    button.onclick = () =>
      setCenterView(
        button.dataset.centerView === "preview"
          ? "preview"
          : button.dataset.centerView === "agents"
            ? "agents"
            : button.dataset.centerView === "chat"
              ? "chat"
              : "editor",
      );
  });
element<HTMLFormElement>("browserForm").onsubmit = (event) => {
  event.preventDefault();
  navigatePreview(browserUrl.value);
};
browserBack.onclick = () => {
  if (browserView.canGoBack()) browserView.goBack();
};
browserForward.onclick = () => {
  if (browserView.canGoForward()) browserView.goForward();
};
browserReload.onclick = () => {
  if (browserView.getURL() !== "about:blank") browserView.reload();
};
browserExternal.onclick = () =>
  void window.trussDesktop
    .openExternal(browserUrl.value)
    .catch((error) =>
      notify(error instanceof Error ? error.message : String(error)),
    );
browserView.addEventListener("dom-ready", updateBrowserNavigation);
browserView.addEventListener("did-navigate", updateBrowserNavigation);
browserView.addEventListener("did-navigate-in-page", updateBrowserNavigation);
browserView.addEventListener("did-fail-load", (event) => {
  const detail = event as Event & {
    readonly errorCode?: number;
    readonly errorDescription?: string;
  };
  if (detail.errorCode === -3) return;
  notify(
    detail.errorDescription
      ? `Preview failed: ${detail.errorDescription}`
      : "Preview failed to load.",
  );
});
window.addEventListener("keydown", (event) => {
  if (event.ctrlKey && event.key.toLowerCase() === "s") {
    event.preventDefault();
    void saveActiveFile();
    return;
  }
  if (
    centerView === "editor" &&
    event.ctrlKey &&
    event.key.toLowerCase() === "w" &&
    activeFile
  ) {
    event.preventDefault();
    closeEditorTab(activeFile);
    return;
  }
  if (
    centerView === "editor" &&
    event.ctrlKey &&
    event.key === "Tab" &&
    openEditorTabs.length > 1
  ) {
    event.preventDefault();
    const current = openEditorTabs.findIndex((tab) => tab.path === activeFile);
    const direction = event.shiftKey ? -1 : 1;
    selectEditorTab(
      openEditorTabs[
        (current + direction + openEditorTabs.length) % openEditorTabs.length
      ],
    );
    return;
  }
  if (
    centerView === "preview" &&
    event.ctrlKey &&
    event.key.toLowerCase() === "l"
  ) {
    event.preventDefault();
    browserUrl.focus();
    browserUrl.select();
  }
  if (centerView === "preview" && event.key === "F5") {
    event.preventDefault();
    if (browserView.getURL() !== "about:blank") browserView.reload();
  }
  if (centerView === "preview" && event.key === "F12") {
    event.preventDefault();
    browserView.openDevTools();
  }
});

window.trussDesktop.onEvent(handleEvent);
window.setInterval(renderTerminalPrompt, 1_000);
void (async () => {
  [desktopState, credentialStorage] = await Promise.all([
    window.trussDesktop.initialState(),
    window.trussDesktop.credentialStorage(),
  ]);
  agentsSnapshot = await window.trussDesktop.listAgents();
  for (const conversation of desktopState.conversations) {
    if (conversation.toolActivity?.length)
      toolActivityByConversation.set(conversation.id, [
        ...conversation.toolActivity,
      ]);
  }
  applyTheme(desktopState.theme);
  populateSettings();
  if (desktopState.runtimeError) {
    openSettings();
    notify(desktopState.runtimeError);
  }
  await discover(desktopState.configuration);
  await Promise.all([
    loadFiles(),
    refreshGit(),
    window.trussDesktop.getPlan().then((plan) => {
      activePlan = plan;
      renderPlan();
    }),
  ]);
  await restoreWorkspaceUiState();
  resetSidebarTracks();
  renderConversations();
  renderChat();
  renderRuntime();
})();
