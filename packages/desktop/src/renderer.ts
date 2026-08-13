import type {
  AgentApprovalPolicy,
  ChatAttachment,
  ProviderAccount,
  WorkspacePlan,
} from "@truss-harness/runtime";
import { scheduleConversationNavigation } from "./conversation-navigation.js";
import { previewServerUrlFromOutput } from "./preview-url.js";
import { markChangedAgentRuns } from "./renderer/agents/snapshot.js";
import {
  addTokenUsage,
  attachedWorkspacePaths,
  DesktopChatController,
  estimatedConversationUsage,
  isDirectWorkspaceChangeRequest,
  rankSlashFiles,
  tokenEstimate,
} from "./renderer/chat/chat-controller.js";
import {
  DesktopEditorController,
  type EditorTab,
  editorPath,
  type SyntaxDiagnostic,
} from "./renderer/editor/editor-controller.js";
import {
  childEntryPath,
  entryName,
  entryParent,
  type FileContextTarget,
  fuzzyPathScore,
  WorkspaceFilesController,
} from "./renderer/files/workspace-files-controller.js";
import { DesktopGitController } from "./renderer/git/git-controller.js";
import {
  DesktopGitDomView,
  desktopGitElements,
} from "./renderer/git/git-view.js";
import { desktopClient } from "./renderer/ipc/desktop-client.js";
import {
  type CenterView,
  DesktopLayoutController,
} from "./renderer/layout/layout-controller.js";
import {
  appendHighlightedCode,
  createMarkdownRenderer,
} from "./renderer/markdown/markdown.js";
import {
  buildProviderConnectionConfiguration,
  buildSettingsConfiguration,
  isLocalProvider,
  parseMcpConfigurations,
  preferredProviderAccount,
  SettingsController,
} from "./renderer/settings/settings-controller.js";
import { desktopSettingsElements } from "./renderer/settings/settings-elements.js";
import {
  initialDesktopState,
  RendererStateStore,
} from "./renderer/state/renderer-state.js";
import {
  applyTheme as applyDesktopTheme,
  parseCustomTheme as parseCustomThemePalette,
  themeDisplayName,
} from "./renderer/theme/theme.js";
import {
  type DesktopAgentsSnapshot,
  type DesktopConfiguration,
  type DesktopConversation,
  type DesktopEndpoint,
  type DesktopEvent,
  type DesktopFile,
  type DesktopMessage,
  type DesktopModelInfo,
  type DesktopProvider,
  type DesktopThemePreference,
  type DesktopToolActivity,
  type DesktopWorkspaceUiState,
  desktopThemeNames,
} from "./shared.js";

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

const desktop = desktopClient(window);
const rendererState = new RendererStateStore(initialDesktopState);

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
const terminal = document.querySelector<HTMLElement>(
  ".terminal",
) as HTMLElement;
const gitElements = desktopGitElements(document);
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
const chatArea = document.querySelector<HTMLElement>(
  ".chat-area",
) as HTMLElement;
const toggleChat = element<HTMLButtonElement>("toggleChat");
const showChatPanel = element<HTMLButtonElement>("showChatPanel");
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
const {
  settingsPanel,
  endpointSelect,
  providerSelect,
  byokProviderSelect,
  baseUrlInput,
  modelInput,
  byokBaseUrl,
  byokModelSelect,
  byokModelInput,
  providerAccountSelect,
  providerAccountLabel,
  newProviderAccount,
  saveProviderAccount,
  deleteProviderAccount,
  discoverByokModels,
  apiKeyInput,
  clearApiKey,
  testProviderConnection,
  providerConnectionResult,
  credentialStorageStatus,
  modelOptions,
  contextInput,
  permissionSelect,
  internetAccessInput,
  autocompleteEnabled,
  autocompleteModel,
  formatOnSave,
  mcpServersInput,
  mcpStatus,
  mcpServerList,
  mcpServerEditor,
  mcpEditorTitle,
  mcpNameInput,
  mcpCommandInput,
  mcpArgsInput,
  mcpCwdInput,
  mcpEnabledInput,
  mcpReadOnlyInput,
  checkUpdatesOnLaunch,
  autoDownloadUpdates,
  themeSelect,
  customThemeSetting,
  customThemeInput,
  customThemeHelp,
  customThemeActions,
  saveCustomTheme,
  updateStatus,
  checkUpdates,
  downloadUpdate,
  installUpdate,
  updateAvailableDialog,
  updateAvailableMessage,
  openUpdateSettings,
} = desktopSettingsElements(document);
const settingsPanelHome = document.createComment("settings-panel-home");
settingsPanel.before(settingsPanelHome);
const toast = element<HTMLDivElement>("toast");

const settingsController = new SettingsController();
let endpoints: readonly DesktopEndpoint[] = [];
let resolveFileEntry: ((value: string | undefined) => void) | undefined;
let resolveConfirmation: ((value: boolean) => void) | undefined;
let inlineCompletion = "";
let completionTimer: number | undefined;
let completionRequest = 0;
let syntaxTimer: number | undefined;
let lastZoomWheelAt = 0;
type ToolActivity = DesktopToolActivity;
const settingsEditorPath = "__truss_settings__";
const editorController = new DesktopEditorController(settingsEditorPath);
const workspaceFilesController = new WorkspaceFilesController();
const openEditorTabs = editorController.tabs;
const chatController = new DesktopChatController();
let persistTimer: number | undefined;
let workspaceUiPersistTimer: number | undefined;
let gitController: DesktopGitController;
let activePlan: WorkspacePlan | undefined;
let layoutController: DesktopLayoutController;
let agentsSnapshot: DesktopAgentsSnapshot = { profiles: [], runs: [] };
const reflectedManagedAgentRunIds = new Set<string>();
let selectedAgentRunId: string | undefined;
const terminalOutputByCommand = new Map<string, string>();
const previewUrlByTerminalCommand = new Map<string, string>();
type SettingsTab = "local" | "byok" | "other";
const maxAttachmentCount = 5;
const maxAttachmentBytes = 4 * 1024 * 1024;
const maxAttachmentTotalBytes = 12 * 1024 * 1024;
const maxFileTextCharacters = 120_000;
const longPasteAttachmentThreshold = 12_000;

function configuration(): DesktopConfiguration {
  return rendererState.configuration();
}

function knownModel(
  modelId = configuration().model,
): DesktopModelInfo | undefined {
  return rendererState.knownModel(modelId);
}

const localModels = (): readonly DesktopModelInfo[] =>
  rendererState.models("local");
const cloudModels = (): readonly DesktopModelInfo[] =>
  rendererState.models("cloud");

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

function renderCustomThemeControls(): void {
  const custom = themeSelect.value === "custom";
  customThemeSetting.hidden = !custom;
  customThemeHelp.hidden = !custom;
  customThemeActions.hidden = !custom;
}

async function saveTheme(theme: DesktopThemePreference): Promise<void> {
  applyDesktopTheme(document.documentElement, theme);
  rendererState.desktop = await desktop.configureTheme(theme);
  notify(`${themeDisplayName(theme)} theme saved.`);
}

function byokBaseUrlForSelectedProvider(): string {
  return byokProviderSelect.selectedOptions[0]?.dataset.baseUrl ?? "";
}

function providerAccountsFor(
  provider: DesktopProvider,
): readonly ProviderAccount[] {
  return (rendererState.desktop.providerAccounts ?? []).filter(
    (account) => account.providerId === provider,
  );
}

function renderProviderAccounts(preferredId?: string): void {
  const provider = byokProviderSelect.value as DesktopProvider;
  const accounts = providerAccountsFor(provider);
  const currentId = configuration().credentialAccountId;
  const nextId = preferredProviderAccount(
    accounts,
    provider,
    preferredId,
    currentId,
  )?.id;
  settingsController.selectedProviderAccountId = nextId;
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
  providerAccountLabel.value = settingsController.creatingProviderAccount
    ? ""
    : (selected?.label ?? "");
  deleteProviderAccount.disabled =
    !selected || settingsController.creatingProviderAccount;
  saveProviderAccount.textContent = settingsController.creatingProviderAccount
    ? "Create account"
    : "Save account";
}

function renderByokModels(preferredModel?: string): void {
  const current = preferredModel ?? byokModelInput.value.trim();
  byokModelSelect.replaceChildren(
    ...(cloudModels().length
      ? cloudModels().map((model) => {
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
  byokModelSelect.value = cloudModels().some((model) => model.id === current)
    ? current
    : "";
}

async function discoverByokModelList(): Promise<void> {
  const provider = byokProviderSelect.value as DesktopProvider;
  discoverByokModels.disabled = true;
  try {
    const result = await desktop.discoverModels(
      {
        provider,
        baseUrl: byokBaseUrlForSelectedProvider(),
        credentialAccountId: settingsController.selectedProviderAccountId,
      },
      apiKeyInput.value.trim() || undefined,
    );
    rendererState.setModels("cloud", result.models);
    renderByokModels();
    if (!cloudModels().length)
      throw new Error("The provider returned no models.");
    notify(
      `Loaded ${cloudModels().length} ${provider} model${cloudModels().length === 1 ? "" : "s"}.`,
    );
  } catch (error) {
    rendererState.setModels("cloud", []);
    renderByokModels();
    notify(error instanceof Error ? error.message : String(error));
  } finally {
    discoverByokModels.disabled = false;
  }
}

function setSettingsTab(tab: SettingsTab): void {
  if (tab !== "other") settingsController.modelTab = tab;
  if (tab === "byok") {
    byokBaseUrl.value = byokBaseUrlForSelectedProvider();
    renderProviderAccounts(settingsController.selectedProviderAccountId);
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
  return chatController.activeConversation(
    rendererState.desktop.conversations,
    rendererState.desktop.activeConversationId,
  );
}

function conversationById(
  id: string | undefined,
): DesktopConversation | undefined {
  return chatController.conversation(rendererState.desktop.conversations, id);
}

function createId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
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

function setCenterView(next: CenterView): void {
  layoutController.setCenterView(next);
}

const agentCloudProviders = [
  ["openai", "OpenAI", "https://api.openai.com/v1"],
  ["anthropic", "Anthropic", "https://api.anthropic.com/v1"],
  ["openrouter", "OpenRouter", "https://openrouter.ai/api/v1"],
  ["groq", "Groq", "https://api.groq.com/openai/v1"],
  ["together", "Together AI", "https://api.together.ai/v1"],
  [
    "gemini",
    "Google Gemini",
    "https://generativelanguage.googleapis.com/v1beta/openai",
  ],
  ["xai", "xAI", "https://api.x.ai/v1"],
  ["mistral", "Mistral AI", "https://api.mistral.ai/v1"],
  ["deepseek", "DeepSeek", "https://api.deepseek.com"],
  ["perplexity", "Perplexity", "https://api.perplexity.ai"],
  ["fireworks", "Fireworks AI", "https://api.fireworks.ai/inference/v1"],
  ["nvidia-nim", "NVIDIA NIM", "https://integrate.api.nvidia.com/v1"],
  ["xiaomi-mimo", "Xiaomi MiMo", "https://api.xiaomimimo.com/v1"],
  ["sakana-fugu", "Sakana Fugu", "https://api.sakana.ai/v1"],
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
  const workspaceChanged = markChangedAgentRuns(
    snapshot,
    reflectedManagedAgentRunIds,
  );
  agentsSnapshot = snapshot;
  if (layoutController.view === "agents") renderAgents();
  if (workspaceChanged)
    void Promise.all([loadFiles(), gitController.refresh()]).catch((error) =>
      notify(error instanceof Error ? error.message : String(error)),
    );
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
    void desktop
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
    ...agentProviderOptions(
      rendererState.desktop.configuration?.provider ?? "ollama",
    ),
  );
  const endpoint = document.createElement("input");
  endpoint.placeholder = "Endpoint URL";
  endpoint.value =
    rendererState.desktop.configuration?.baseUrl ??
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
    const selected =
      model.value || rendererState.desktop.configuration?.model || "";
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
      const result = await desktop.discoverModels({
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
  const approvalPolicy = agentApprovalPolicySelect(
    rendererState.desktop.configuration?.permission ?? "ask",
  );
  const add = document.createElement("button");
  add.className = "primary";
  add.textContent = "Create agent";
  create.append(
    name,
    provider,
    endpoint,
    model,
    account,
    mode,
    approvalPolicy,
    add,
  );
  create.onsubmit = (event) => {
    event.preventDefault();
    const providerId = provider.value;
    void desktop
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
        approvalPolicy: approvalPolicy.value as AgentApprovalPolicy,
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
      ? rendererState.desktop.providerAccounts?.find(
          (candidate) => candidate.id === profile.provider.credentialRef,
        )?.label
      : undefined;
    binding.textContent = `${profile.provider.providerId} · ${profile.provider.modelId} · ${profile.mode}${accountLabel ? ` · ${accountLabel}` : ""}${profile.provider.endpointUrl ? ` · ${profile.provider.endpointUrl}` : ""}`;
    const profileSettings = document.createElement("div");
    profileSettings.className = "agent-card-settings";
    const policyLabel = document.createElement("label");
    const policyLabelText = document.createElement("span");
    policyLabelText.textContent = "Tool permissions";
    const policy = agentApprovalPolicySelect(profile.approvalPolicy);
    policy.disabled = Boolean(activeRun);
    if (activeRun)
      policy.title = "Stop this agent before changing its tool permissions.";
    policy.onchange = () => {
      const nextPolicy = policy.value as AgentApprovalPolicy;
      policy.disabled = true;
      void desktop
        .updateAgent(profile.id, { approvalPolicy: nextPolicy })
        .then(applyAgentsSnapshot)
        .catch((error) => {
          policy.value = profile.approvalPolicy;
          policy.disabled = Boolean(activeRun);
          notify(error instanceof Error ? error.message : String(error));
        });
    };
    policyLabel.append(policyLabelText, policy);
    profileSettings.append(policyLabel);
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
      void desktop
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
      void desktop
        .stopAgent(activeRun.id)
        .then(applyAgentsSnapshot)
        .catch((error) =>
          notify(error instanceof Error ? error.message : String(error)),
        );
    const remove = document.createElement("button");
    remove.textContent = "Delete";
    remove.disabled = Boolean(activeRun);
    remove.onclick = () =>
      void desktop
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
          void desktop
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
    card.append(details, binding, profileSettings, prompt, actions, progress);
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

function agentApprovalPolicySelect(
  selected: AgentApprovalPolicy,
): HTMLSelectElement {
  const select = document.createElement("select");
  select.title = "Tool permissions";
  select.setAttribute("aria-label", "Tool permissions");
  for (const [value, label] of [
    ["ask", "Ask for every tool"],
    ["auto-read", "Allow read-only tools"],
    ["auto-all", "Allow all tools"],
  ] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = value === selected;
    select.append(option);
  }
  return select;
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
    void desktop.saveConversations(
      rendererState.desktop.conversations,
      rendererState.desktop.activeConversationId,
    );
  }, 220);
}

function workspaceUiState(): DesktopWorkspaceUiState {
  preserveEditorScroll();
  return {
    expandedDirectories: [...workspaceFilesController.expandedDirectories],
    openEditors: editorController.persistedTabs(),
    activeFile: activeWorkspaceFilePath(),
    fileTreeScrollTop: fileTree.scrollTop,
  };
}

function saveWorkspaceUiState(): void {
  window.clearTimeout(workspaceUiPersistTimer);
  workspaceUiPersistTimer = window.setTimeout(() => {
    const state = workspaceUiState();
    rendererState.desktop = {
      ...rendererState.desktop,
      workspaceUiState: state,
    };
    void desktop.saveWorkspaceUiState(state);
  }, 180);
}

function renderChatRunState(): void {
  sendChatButton.hidden = chatController.busy;
  cancelChatButton.hidden = !chatController.busy;
  chatStatus.textContent = chatController.agentActivity;
  statusDot.className = `status-dot ${chatController.busy ? "busy" : rendererState.desktop.configuration?.model ? "ready" : ""}`;
  renderChat();
  renderRuntime();
}

function setChatCollapsed(next: boolean): void {
  layoutController.setChatCollapsed(next);
}

function setChatDocked(next: boolean): void {
  layoutController.setChatDocked(next);
}

function syntaxDiagnostics(path: string): readonly SyntaxDiagnostic[] {
  return editorController.diagnostics(path);
}

function syntaxErrorTitle(path: string): string | undefined {
  const diagnostic = syntaxDiagnostics(path)[0];
  return diagnostic
    ? `Syntax error on line ${diagnostic.line}: ${diagnostic.message}`
    : undefined;
}

function hasSyntaxError(path: string): boolean {
  return syntaxDiagnostics(path).length > 0;
}

function setSyntaxDiagnostics(
  path: string,
  diagnostics: readonly SyntaxDiagnostic[],
): void {
  if (editorController.setDiagnostics(path, diagnostics)) {
    renderEditorTabs();
    renderFiles();
    gitController.render();
  }
}

function cancelActiveRunForNavigation(): void {
  if (!chatController.busy) return;
  const running = conversationById(chatController.runningConversationId);
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
  chatController.cancelRun();
  renderChatRunState();
  void desktop.stopChat();
}

function renderRuntime(): void {
  const config = rendererState.desktop.configuration;
  runtimeStatus.textContent = config?.model
    ? `${config.provider} / ${config.model}`
    : "No model selected";
  statusDot.className = `status-dot ${chatController.busy ? "busy" : config?.model ? "ready" : ""}`;
  document
    .querySelectorAll<HTMLButtonElement>("[data-mode]")
    .forEach((button) => {
      button.classList.toggle(
        "active",
        button.dataset.mode === configuration().mode,
      );
    });
  const values = [
    ...new Set(
      [config?.model, ...localModels().map((model) => model.id)].filter(
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
    : chatController.busy
      ? "Usage pending"
      : "Usage --";
  chatStatus.textContent = chatController.busy
    ? chatController.agentActivity
    : "Ready";
  const elapsed = chatController.streamMetrics.startedAt
    ? (performance.now() - chatController.streamMetrics.startedAt) / 1_000
    : 0;
  const estimatedTokens = chatController.streamMetrics.textCharacters / 4;
  if (rateMeter) {
    rateMeter.textContent =
      estimatedTokens && elapsed > 0
        ? `Output ${(estimatedTokens / elapsed).toFixed(1)} est. tok/s`
        : chatController.busy
          ? `Working · ${chatController.agentActivity}`
          : "Output -- tok/s";
  }
}

function renderTerminalPrompt(): void {
  const workspaceParts = rendererState.desktop.workspaceRoot
    .replaceAll("\\", "/")
    .split("/")
    .filter(Boolean);
  const path =
    workspaceParts.length > 3
      ? `…/${workspaceParts.slice(-3).join("/")}`
      : workspaceParts.join("/") || "No workspace";
  const gitStatus = gitController.status;
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

function renderFiles(): void {
  const scrollTop = fileTree.scrollTop;
  fileTree.replaceChildren();
  window.requestAnimationFrame(() => {
    fileTree.scrollTop = scrollTop;
  });
  if (!workspaceFilesController.entries.length) {
    const empty = document.createElement("div");
    empty.className = "empty-chat";
    empty.textContent = "No files loaded.";
    fileTree.append(empty);
    return;
  }
  const query = workspaceFilesController.query.trim();
  clearFileSearch.hidden = !query;
  if (query) {
    const matches = workspaceFilesController.entries
      .filter((file) => file.type === "file")
      .flatMap((file) => {
        const score = fuzzyPathScore(file.path, query);
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
      const syntaxError = syntaxErrorTitle(file.path);
      row.classList.toggle("has-syntax-error", Boolean(syntaxError));
      button.title = syntaxError ? `${file.path}\n${syntaxError}` : file.path;
      button.dataset.path = editorPath(file.path);
      if (editorPath(file.path) === editorController.activePath)
        button.classList.add("active");
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
  for (const file of workspaceFilesController.entries) {
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
      const expanded = workspaceFilesController.isExpanded(directoryPath);
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
        const isExpanded =
          workspaceFilesController.toggleExpanded(directoryPath);
        if (isExpanded) {
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
      const syntaxError = syntaxErrorTitle(file.path);
      row.classList.toggle("has-syntax-error", Boolean(syntaxError));
      button.title = syntaxError ? `${file.path}\n${syntaxError}` : file.path;
      button.dataset.path = editorPath(file.path);
      if (editorPath(file.path) === editorController.activePath)
        button.classList.add("active");
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
      button.classList.toggle(
        "active",
        button.dataset.path === editorController.activePath,
      );
    });
}

function mergeFiles(entries: readonly DesktopFile[]): void {
  workspaceFilesController.merge(entries);
}

async function loadDirectoryContents(path: string): Promise<void> {
  if (!workspaceFilesController.needsDirectory(path)) return;
  const entries = await desktop.listDirectory(path);
  mergeFiles(entries);
  workspaceFilesController.markDirectoryLoaded(path);
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
  rendererState.desktop.conversations.forEach((conversation) => {
    const row = document.createElement("div");
    row.className = "conversation-row";
    const select = document.createElement("button");
    select.type = "button";
    select.textContent = conversation.title;
    select.title = conversation.title;
    if (conversation.id === rendererState.desktop.activeConversationId)
      select.classList.add("active");
    select.onclick = () => {
      if (conversation.id !== rendererState.desktop.activeConversationId)
        cancelActiveRunForNavigation();
      rendererState.desktop = {
        ...rendererState.desktop,
        activeConversationId: conversation.id,
      };
      finishConversationNavigation();
    };
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "delete";
    remove.textContent = "x";
    remove.title = "Delete conversation";
    remove.onclick = async () => {
      if (
        !(await requestConfirmation({
          title: "Delete conversation",
          message: `Delete "${conversation.title}"?`,
          confirmLabel: "Delete",
          danger: true,
        }))
      )
        return;
      if (conversation.id === rendererState.desktop.activeConversationId)
        cancelActiveRunForNavigation();
      const removal = chatController.removeConversation(
        rendererState.desktop.conversations,
        rendererState.desktop.activeConversationId,
        conversation.id,
      );
      rendererState.desktop = {
        ...rendererState.desktop,
        conversations: removal.conversations,
        activeConversationId: removal.activeConversationId,
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
  return workspaceFilesController.entries.some(
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

const renderMarkdown = createMarkdownRenderer({
  document,
  resolveWorkspaceFile: workspaceFileReference,
  openWorkspaceFile: openChatFile,
});

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
  const activities = chatController.activities(conversation.id);
  const pendingSummary =
    chatController.busy &&
    conversation.id === chatController.runningConversationId
      ? chatController.agentActivity
      : undefined;
  if (activities.length || pendingSummary) {
    toolActivityPanel.hidden = false;
    toolActivityPanel.replaceChildren(
      toolActivityView(conversation.id, activities, pendingSummary),
    );
  } else {
    toolActivityPanel.hidden = true;
  }
  const lastAssistantIndex = conversation.messages
    .map((message) => message.role)
    .lastIndexOf("assistant");
  const showActivePlaceholder =
    chatController.busy &&
    conversation.id === chatController.runningConversationId;
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
      const cost =
        usage.estimatedCostUsd !== undefined
          ? ` · ${formatUsd(usage.estimatedCostUsd)}`
          : "";
      result.textContent += ` · ${formatTokens(usage.inputTokens)} in / ${formatTokens(usage.outputTokens)} out${cost}${usage.estimated ? " est." : ""}`;
      result.title =
        "Provider usage when available; otherwise estimated from message text.";
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

function createConversation(): DesktopConversation {
  const created = chatController.createConversation(
    rendererState.desktop.conversations,
    createId(),
    new Date().toISOString(),
  );
  rendererState.desktop = {
    ...rendererState.desktop,
    conversations: created.conversations,
    activeConversationId: created.conversation.id,
  };
  return created.conversation;
}

function ensureConversation(): DesktopConversation {
  return activeConversation() ?? createConversation();
}

function updateConversation(
  conversationId: string,
  update: (conversation: DesktopConversation) => DesktopConversation,
): void {
  rendererState.desktop = {
    ...rendererState.desktop,
    conversations: chatController.updateConversation(
      rendererState.desktop.conversations,
      conversationId,
      update,
    ),
  };
}

function setToolActivity(
  conversationId: string,
  activities: readonly ToolActivity[],
): void {
  chatController.setActivities(conversationId, activities);
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
  fileDiffToggle.textContent = editorController.showingDiff ? "File" : "Diff";
  fileDiffToggle.title = editorController.showingDiff
    ? "Show the current file"
    : "Show the current file's diff";
  fileDiffToggle.setAttribute(
    "aria-label",
    editorController.showingDiff ? "Show file" : "Show diff",
  );
}

function workspaceMediaUrl(path: string): string {
  return `truss-media://workspace/${encodeURIComponent(path.replaceAll("\\", "/"))}`;
}

function activeEditorTab(): EditorTab | undefined {
  return editorController.activeTab();
}

function activeWorkspaceFilePath(): string | undefined {
  return editorController.activeWorkspacePath();
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
        void desktop
          .checkSyntax(tab.path, input.value)
          .then((items) => {
            if (input.value !== tab.content) return;
            setSyntaxDiagnostics(tab.path, items);
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
        void desktop
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
  editorController.select(tab);
  setCenterView("editor");
  renderEditorTabs();
  renderEditorContent(tab);
  updateFileSelection();
  saveWorkspaceUiState();
}

function openSettings(): void {
  let tab = openEditorTabs.find((candidate) => candidate.mode === "settings");
  if (tab && tab.path === editorController.activePath) {
    closeEditorTab(tab.path);
    return;
  }
  populateSettings();
  if (!tab) {
    tab = editorController.add(settingsEditorPath, "settings", "ready");
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
  const wasActive = editorController.activePath === path;
  if (wasActive) preserveEditorScroll();
  const result = editorController.close(path);
  if (wasActive) {
    if (result.next) {
      selectEditorTab(result.next);
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
    container.className = `editor-tab ${tab.mode === "diff" ? "diff" : ""} ${tab.path === editorController.activePath ? "active" : ""} ${hasSyntaxError(tab.path) ? "has-syntax-error" : ""}`;
    container.setAttribute("role", "presentation");
    const select = document.createElement("button");
    select.className = "editor-tab-main";
    select.type = "button";
    select.setAttribute("role", "tab");
    select.setAttribute(
      "aria-selected",
      String(tab.path === editorController.activePath),
    );
    if (tab.mode === "settings") select.textContent = "Settings";
    else
      appendFileLabel(
        select,
        tab.path,
        `${tab.dirty ? "* " : ""}${tab.path.split(/[\\/]/).at(-1) ?? tab.path}`,
      );
    const title =
      tab.mode === "settings"
        ? "Settings"
        : `${tab.mode === "diff" ? "Diff: " : ""}${tab.path}`;
    const syntaxError = syntaxErrorTitle(tab.path);
    select.title = syntaxError ? `${title}\n${syntaxError}` : title;
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
}

async function loadEditorTab(tab: EditorTab): Promise<void> {
  const revision = ++tab.revision;
  tab.state = "loading";
  if (tab.path === editorController.activePath) renderEditorContent(tab);
  try {
    const content =
      tab.mode === "file" && mediaKindForPath(tab.path)
        ? ""
        : tab.mode === "diff"
          ? await desktop.diffFile(tab.path)
          : await desktop.readFile(tab.path);
    if (revision !== tab.revision) return;
    tab.content = content;
    tab.dirty = false;
    tab.state = "ready";
  } catch (error) {
    if (revision !== tab.revision) return;
    tab.content = `Unable to open ${tab.path}: ${error instanceof Error ? error.message : String(error)}`;
    tab.state = "error";
  }
  if (tab.path === editorController.activePath) renderEditorContent(tab);
}

async function openFile(
  path: string,
  diff: boolean,
  switchMode = false,
): Promise<void> {
  const normalizedPath = editorPath(path);
  let tab = editorController.find(normalizedPath);
  if (!tab) {
    tab = editorController.add(
      normalizedPath,
      diff ? "diff" : "file",
      "loading",
    );
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
    workspaceFilesController.replace(await desktop.listFiles());
    await Promise.all(
      [...workspaceFilesController.expandedDirectories].map((path) =>
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
  let formatError: unknown;
  if (configuration().formatOnSave) {
    try {
      tab.content = await desktop.formatFile(tab.path, tab.content);
    } catch (error) {
      // Formatting must not prevent a user from saving an unfinished file.
      formatError = error;
    }
  }
  try {
    await desktop.writeFile(tab.path, tab.content);
    tab.dirty = false;
    renderEditorTabs();
    renderEditorContent(tab);
    try {
      setSyntaxDiagnostics(
        tab.path,
        await desktop.checkSyntax(tab.path, tab.content),
      );
    } catch {
      // Syntax feedback is best-effort for formats without a local parser.
    }
    await Promise.all([loadFiles(), gitController.refresh()]);
    notify(
      formatError
        ? `Saved ${tab.path}; formatting was skipped because it has syntax errors.`
        : `Saved ${tab.path}`,
    );
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
    tab.content = await desktop.formatFile(tab.path, tab.content);
    await desktop.writeFile(tab.path, tab.content);
    tab.dirty = false;
    renderEditorTabs();
    renderEditorContent(tab);
    await Promise.all([loadFiles(), gitController.refresh()]);
    notify(`Formatted and saved ${tab.path}`);
  } catch (error) {
    notify(error instanceof Error ? error.message : String(error));
  } finally {
    formatFileButton.disabled = false;
  }
}

async function discover(input?: Partial<DesktopConfiguration>): Promise<void> {
  const result = await desktop.discoverModels(input);
  endpoints = result.endpoints;
  rendererState.setModels("local", result.models);
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
    ...localModels().map((model) => {
      const option = document.createElement("option");
      option.value = model.id;
      return option;
    }),
  );
  renderRuntime();
}

function settingsConfiguration(): DesktopConfiguration {
  const model = (
    settingsController.modelTab === "byok"
      ? byokModelInput.value
      : modelInput.value
  ).trim();
  return buildSettingsConfiguration({
    current: configuration(),
    modelTab: settingsController.modelTab,
    localProvider: providerSelect.value as DesktopProvider,
    localBaseUrl: baseUrlInput.value,
    localModel: modelInput.value,
    cloudProvider: byokProviderSelect.value as DesktopProvider,
    cloudBaseUrl: byokBaseUrlForSelectedProvider(),
    cloudModel: byokModelInput.value,
    credentialAccountId: settingsController.selectedProviderAccountId,
    permission: permissionSelect.value,
    contextWindow: contextInput.value,
    selectedModel: knownModel(model),
    internetAccess: internetAccessInput.checked,
    autocompleteEnabled: autocompleteEnabled.checked,
    autocompleteModel: autocompleteModel.value,
    formatOnSave: formatOnSave.checked,
    mcpServers: parseMcpConfigurations(mcpServersInput.value),
  });
}

function syncMcpAdvancedJson(): void {
  mcpServersInput.value = Object.keys(settingsController.mcpDraft).length
    ? JSON.stringify(settingsController.mcpDraft, null, 2)
    : "";
}

function openMcpEditor(name?: string): void {
  settingsController.editingMcpName = name;
  const configuration = name ? settingsController.mcpDraft[name] : undefined;
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
  settingsController.editingMcpName = undefined;
  mcpServerEditor.hidden = true;
}

function renderMcpManager(): void {
  const runtimeStatuses = new Map(
    (rendererState.desktop.mcpStatuses ?? []).map((status) => [
      status.name,
      status,
    ]),
  );
  const names = Object.keys(settingsController.mcpDraft).sort((left, right) =>
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
      const configuration = settingsController.mcpDraft[name];
      const status = settingsController.testedMcpStatuses.get(name) ??
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
  return buildProviderConnectionConfiguration({
    current: configuration(),
    modelTab: settingsController.modelTab,
    localProvider: providerSelect.value as DesktopProvider,
    localBaseUrl: baseUrlInput.value,
    localModel: modelInput.value,
    cloudProvider: byokProviderSelect.value as DesktopProvider,
    cloudBaseUrl: byokBaseUrlForSelectedProvider(),
    cloudModel: byokModelInput.value,
    credentialAccountId: settingsController.selectedProviderAccountId,
  });
}

function clearProviderConnectionResult(): void {
  providerConnectionResult.hidden = true;
  providerConnectionResult.textContent = "";
  providerConnectionResult.className = "provider-connection-result";
}

function renderCredentialStorageStatus(): void {
  const sessionOnly = rendererState.credentialStorage === "session-only";
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
        ? status.manual
          ? `Version${version} is available. Download the update for this package.`
          : `Version${version} is available.`
        : status.status === "not-available"
          ? "Truss is up to date."
          : status.status === "downloading"
            ? `Downloading update${status.percent === undefined ? "..." : ` (${Math.round(status.percent)}%)`}`
            : status.status === "downloaded"
              ? `Version${version} is ready to install.`
              : (status.message ?? "Unable to check for updates.");
  downloadUpdate.hidden = status.status !== "available";
  installUpdate.hidden = status.status !== "downloaded";
  downloadUpdate.textContent = status.manual ? "Open download" : "Download";
  checkUpdates.disabled =
    status.status === "checking" || status.status === "downloading";
  downloadUpdate.disabled = status.status === "downloading";
  if (
    status.status === "available" &&
    status.version &&
    settingsController.announcedUpdateVersion !== status.version
  ) {
    settingsController.announcedUpdateVersion = status.version;
    updateAvailableMessage.textContent = `Truss ${status.version} is available. You can review the download and install options now or later.`;
    if (!updateAvailableDialog.open) updateAvailableDialog.showModal();
  }
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
    rendererState.setModels("cloud", []);
    renderByokModels(current.model);
    settingsController.creatingProviderAccount = false;
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
  settingsController.loadMcpDraft(current.mcpServers);
  syncMcpAdvancedJson();
  checkUpdatesOnLaunch.checked = rendererState.desktop.updates.checkOnLaunch;
  autoDownloadUpdates.checked = rendererState.desktop.updates.autoDownload;
  themeSelect.value = desktopThemeNames.includes(
    rendererState.desktop.theme.name,
  )
    ? rendererState.desktop.theme.name
    : "default";
  customThemeInput.value =
    rendererState.desktop.theme.name === "custom" &&
    rendererState.desktop.theme.custom
      ? JSON.stringify(rendererState.desktop.theme.custom, null, 2)
      : "";
  renderCustomThemeControls();
  renderMcpStatus();
  renderCredentialStorageStatus();
}

async function restoreWorkspaceUiState(): Promise<void> {
  const state = rendererState.desktop.workspaceUiState;
  workspaceFilesController.expandedDirectories.clear();
  editorController.reset();
  if (state) {
    for (const path of state.expandedDirectories)
      workspaceFilesController.markExpanded(path);
    for (const path of [...workspaceFilesController.expandedDirectories].sort(
      (left, right) => left.split("/").length - right.split("/").length,
    )) {
      await loadDirectoryContents(path).catch(() => undefined);
    }
    editorController.restore(state.openEditors, state.activeFile);
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
  const returned = await desktop.configure(
    next,
    apiKeyInput.value || undefined,
  );
  apiKeyInput.value = "";
  rendererState.desktop = returned;
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

function renderSlashMenu(): void {
  const query = slashQuery();
  if (!query) {
    slashMenu.hidden = true;
    chatController.setSlashResults([]);
    return;
  }
  chatController.setSlashResults(
    rankSlashFiles(workspaceFilesController.entries, query.query),
  );
  if (!chatController.slashResults.length) {
    slashMenu.hidden = true;
    return;
  }
  slashMenu.replaceChildren(
    ...chatController.slashResults.map((file, index) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = `slash-option${index === chatController.slashIndex ? " active" : ""}`;
      option.setAttribute("role", "option");
      option.setAttribute(
        "aria-selected",
        String(index === chatController.slashIndex),
      );
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
  attachmentList.hidden = chatController.pendingAttachments.length === 0;
  attachmentList.replaceChildren(
    ...chatController.pendingAttachments.map((attachment) => {
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
        chatController.removePendingAttachment(attachment.id);
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
  if (
    chatController.pendingAttachments.length + selected.length >
    maxAttachmentCount
  ) {
    notify(`Attach up to ${maxAttachmentCount} files at once.`);
    return;
  }
  if (
    chatController.pendingAttachmentBytes() +
      selected.reduce((total, file) => total + file.size, 0) >
    maxAttachmentTotalBytes
  ) {
    notify("Attachments exceed the 12 MB total limit.");
    return;
  }
  try {
    const attachments = await Promise.all(selected.map(toAttachment));
    chatController.addPendingAttachments(attachments);
    renderPendingAttachments();
  } catch (error) {
    notify(error instanceof Error ? error.message : String(error));
  }
}

function hideFileContextMenu(): void {
  fileContextMenu.hidden = true;
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

function removeOpenEditorEntries(path: string, includeChildren: boolean): void {
  const result = editorController.removeEntries(path, includeChildren);
  if (!result.removedActive) {
    renderEditorTabs();
    return;
  }
  if (result.next) selectEditorTab(result.next);
  else {
    editorTitle.textContent = "Workspace";
    renderEditorTabs();
    renderEditorContent(undefined);
  }
}

async function refreshWorkspaceAfterFileOperation(): Promise<void> {
  await Promise.all([loadFiles(), gitController.refresh()]);
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
  if (kind === "file") await desktop.createWorkspaceFile(path);
  else await desktop.createWorkspaceFolder(path);
  const parentPath = entryParent(path);
  workspaceFilesController.markExpanded(parentPath);
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
  await desktop.renameWorkspaceEntry(target.path, nextPath);
  removeOpenEditorEntries(target.path, target.kind === "directory");
  if (target.kind === "directory")
    workspaceFilesController.moveDirectoryState(target.path, nextPath);
  await refreshWorkspaceAfterFileOperation();
  notify(`Renamed to ${nextPath}`);
  if (target.kind === "file") await openFile(nextPath, false);
}

async function pasteWorkspaceFile(target: FileContextTarget): Promise<void> {
  if (!workspaceFilesController.copiedPath) return;
  const parent =
    target.kind === "directory"
      ? target.path
      : target.kind === "file"
        ? entryParent(target.path)
        : "";
  const sourceName = entryName(workspaceFilesController.copiedPath);
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
  await desktop.copyWorkspaceEntry(
    workspaceFilesController.copiedPath,
    destination,
  );
  await refreshWorkspaceAfterFileOperation();
  notify(`Copied to ${destination}`);
  await openFile(destination, false);
}

async function deleteWorkspaceEntry(target: FileContextTarget): Promise<void> {
  const label =
    target.kind === "directory" ? "folder and all of its contents" : "file";
  if (
    !(await requestConfirmation({
      title: `Delete ${label}`,
      message: `Delete ${label} "${target.path}"? This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true,
    }))
  )
    return;
  await desktop.deleteWorkspaceEntry(target.path);
  removeOpenEditorEntries(target.path, target.kind === "directory");
  workspaceFilesController.removeDirectoryState(target.path);
  workspaceFilesController.clearCopiedWithin(
    target.path,
    target.kind === "directory",
  );
  await refreshWorkspaceAfterFileOperation();
  notify(`Deleted ${target.path}`);
}

function showFileContextMenu(
  x: number,
  y: number,
  target: FileContextTarget,
): void {
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
      workspaceFilesController.copiedPath = target.path;
      notify(`Copied ${target.path}`);
    });
    addFileContextAction("Copy Relative Path", async () => {
      await navigator.clipboard.writeText(target.path);
      notify("Copied relative path.");
    });
  }
  if (workspaceFilesController.copiedPath)
    addFileContextAction("Paste File...", () => pasteWorkspaceFile(target), {
      separatorBefore: target.kind !== "file",
    });
  if (target.kind !== "root") {
    addFileContextAction("Rename...", () => renameWorkspaceEntry(target), {
      separatorBefore:
        !workspaceFilesController.copiedPath && target.kind !== "file",
    });
    addFileContextAction("Reveal in File Manager", () =>
      desktop.revealWorkspaceEntry(target.path),
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
  pendingSummary?: string,
): HTMLElement {
  const trace = document.createElement("details");
  trace.className = "tool-activity";
  trace.open = chatController.activityExpanded(conversationId);
  trace.addEventListener("toggle", () =>
    chatController.setActivityExpanded(conversationId, trace.open),
  );
  const summary = document.createElement("summary");
  const running = activities.find((activity) => activity.status === "running");
  const toolCallCount = activities.filter(
    (activity) => activity.status !== "progress",
  ).length;
  summary.textContent = running
    ? `Working: ${running.summary ?? running.tool}`
    : (pendingSummary ??
      `Activity: ${toolCallCount} tool call${toolCallCount === 1 ? "" : "s"}`);
  const list = document.createElement("div");
  list.className = "tool-activity-list";
  for (const activity of activities) {
    const row = document.createElement("div");
    row.className = `tool-activity-row ${activity.status}`;
    const description = activity.summary ?? activity.tool;
    row.textContent =
      activity.status === "progress"
        ? description
        : activity.status === "running"
          ? `${description} · running`
          : activity.status === "failed"
            ? `${description} · failed${activity.detail ? `: ${activity.detail}` : ""}`
            : `${description} · completed`;
    if (activity.detail) row.title = activity.detail;
    list.append(row);
  }
  if (pendingSummary && !activities.length) {
    const row = document.createElement("div");
    row.className = "tool-activity-row running";
    row.textContent = pendingSummary;
    list.append(row);
  }
  trace.append(summary, list);
  return trace;
}

function activityInputText(input: Record<string, unknown> | undefined): string {
  if (!input) return "";
  const path = typeof input.path === "string" ? input.path : "";
  const command = typeof input.command === "string" ? input.command : "";
  const query = typeof input.query === "string" ? input.query : "";
  const pattern = typeof input.pattern === "string" ? input.pattern : "";
  return [path, command, query || pattern].find(Boolean)?.slice(0, 100) ?? "";
}

function safeActivitySummary(
  tool: string,
  input?: Record<string, unknown>,
): string {
  const value = activityInputText(input);
  switch (tool) {
    case "read_file":
      return value ? `Reading ${value}` : "Reading a workspace file";
    case "write_file":
    case "replace_in_file":
      return value ? `Updating ${value}` : "Updating a workspace file";
    case "list_directory":
      return value ? `Listing ${value}` : "Listing workspace files";
    case "search_files":
    case "grep":
      return value ? `Searching for ${value}` : "Searching workspace files";
    case "run_terminal":
      return value ? `Running ${value}` : "Running a workspace command";
    case "git_status":
    case "git_diff":
      return "Inspecting Git changes";
    case "apply_patch":
      return "Applying a focused patch";
    case "update_plan":
      return "Updating the task plan";
    case "web_search":
      return value ? `Searching the web for ${value}` : "Searching the web";
    case "web_fetch":
      return "Reading a web page";
    default:
      return `Running ${tool.replaceAll("_", " ")}`;
  }
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
    (chatController.pendingAttachments.length
      ? "Review the attached files."
      : "");
  if (!prompt || chatController.busy) return;
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
  const attachments = chatController.pendingAttachments;
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
  rendererState.desktop = {
    ...rendererState.desktop,
    activeConversationId: conversation.id,
  };
  chatInput.value = "";
  chatController.clearPendingAttachments();
  attachmentInput.value = "";
  renderPendingAttachments();
  renderConversations();
  renderChat();
  renderRuntime();
  saveConversations();
  try {
    chatController.beginRun(conversation.id);
    renderChatRunState();
    await desktop.sendChat({
      prompt,
      conversationId: conversation.id,
      history,
      attachments,
      activeFilePath: activeWorkspaceFilePath(),
      attachedPaths: attachedWorkspacePaths(
        prompt,
        workspaceFilesController.entries,
      ),
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
    chatController.cancelRun();
    renderChatRunState();
    renderChat();
  }
}

function appendTerminal(text: string): void {
  terminalOutput.textContent = `${terminalOutput.textContent}${text}`.slice(
    -50_000,
  );
  terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

function openAnnouncedServerPreview(commandId: string, text: string): void {
  const output = `${terminalOutputByCommand.get(commandId) ?? ""}${text}`.slice(
    -12_000,
  );
  terminalOutputByCommand.set(commandId, output);
  const url = previewServerUrlFromOutput(output);
  if (!url || previewUrlByTerminalCommand.get(commandId) === url) return;
  previewUrlByTerminalCommand.set(commandId, url);
  navigatePreview(url);
  notify(`Opened server preview: ${url}`);
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
    chatController.beginRun(message.conversationId);
    setToolActivity(message.conversationId, []);
    chatController.setActivityExpanded(message.conversationId, true);
    updateConversation(message.conversationId, (current) => ({
      ...current,
      lastRun: { status: "running", modifiedFiles: [] },
    }));
    renderChatRunState();
    renderChat();
    return;
  }
  if (message.type === "chat-end") {
    const conversation = conversationById(message.conversationId);
    if (conversation?.lastRun && !conversation.lastRun.usage) {
      updateConversation(conversation.id, (current) =>
        current.lastRun
          ? {
              ...current,
              lastRun: {
                ...current.lastRun,
                usage: estimatedConversationUsage(current, knownModel()),
              },
            }
          : current,
      );
      saveConversations();
    }
    if (chatController.endRun(message.conversationId)) {
      renderChatRunState();
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
    if (chatController.endRun(message.conversationId)) {
      renderChatRunState();
    }
    renderChat();
    saveConversations();
    return;
  }
  if (message.type === "terminal-output") {
    appendTerminal(message.text);
    openAnnouncedServerPreview(message.commandId, message.text);
    return;
  }
  if (message.type === "approval") {
    const approvalConversation = activeConversation();
    if (approvalConversation) {
      const waitingSummary = `Waiting for approval: ${safeActivitySummary(message.tool, message.input)}`;
      setToolActivity(
        approvalConversation.id,
        chatController
          .activities(approvalConversation.id)
          .map((activity) =>
            activity.callId === message.callId
              ? { ...activity, summary: waitingSummary }
              : activity,
          ),
      );
      chatController.setAgentActivity("Waiting for approval");
      renderChat();
      renderRuntime();
    }
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
      void desktop.resolveApproval(message.callId, true);
      approval.textContent = `Allowed ${message.tool}`;
    };
    allowAll.onclick = () => {
      void desktop.resolveApproval(message.callId, true, true);
      approval.textContent = "Allowed all tools for this session";
    };
    deny.onclick = () => {
      void desktop.resolveApproval(message.callId, false);
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
    conversationById(chatController.runningConversationId);
  if (event.type === "plan_updated" && event.plan) {
    activePlan = event.plan;
    renderPlan();
    return;
  }
  if (event.type === "usage" && event.usage && conversation) {
    const usage = event.usage;
    updateConversation(conversation.id, (current) => ({
      ...current,
      lastRun: current.lastRun
        ? {
            ...current.lastRun,
            usage: addTokenUsage(current.lastRun.usage, usage, knownModel()),
          }
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
    if (
      layoutController.view === "preview" &&
      browserView.getURL() !== "about:blank"
    )
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
    chatController.recordTextDelta(event.text ?? "", performance.now());
    if (conversation.id === rendererState.desktop.activeConversationId)
      renderChat();
    renderRuntime();
    saveConversations();
  }
  if (event.type === "progress_delta") {
    if (!conversation) return;
    const note = event.text ?? "";
    if (!note) return;
    const activities = chatController.activities(conversation.id);
    const previous = activities.at(-1);
    const nextActivities: ToolActivity[] =
      previous?.status === "progress"
        ? [
            ...activities.slice(0, -1),
            {
              ...previous,
              tool: `${previous.tool}${note}`,
              summary: `${previous.summary ?? previous.tool}${note}`,
            },
          ]
        : [
            ...activities,
            {
              callId: createId(),
              tool: note,
              summary: note,
              status: "progress",
            },
          ];
    setToolActivity(conversation.id, nextActivities);
    chatController.setAgentActivity(
      nextActivities.at(-1)?.summary?.trim() || "Thinking about the next step",
    );
    if (conversation.id === rendererState.desktop.activeConversationId)
      renderChat();
    renderRuntime();
    return;
  }
  if (event.type === "tool_call_requested") {
    const summary = safeActivitySummary(event.tool ?? "tool", event.input);
    chatController.setAgentActivity(summary);
    renderRuntime();
    if (conversation) {
      const activities = chatController.activities(conversation.id);
      setToolActivity(conversation.id, [
        ...activities,
        {
          callId: event.callId ?? createId(),
          tool: event.tool ?? "unknown",
          summary,
          status: "running",
        },
      ]);
      if (conversation.id === rendererState.desktop.activeConversationId)
        renderChat();
    }
  }
  if (event.type === "tool_completed") {
    chatController.setAgentActivity(
      event.result?.isError
        ? "Recovering from a tool error"
        : "Thinking about the next step",
    );
    renderRuntime();
    const result = event.result?.content ?? "";
    if (conversation) {
      const activities = chatController.activities(conversation.id);
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
      if (conversation.id === rendererState.desktop.activeConversationId)
        renderChat();
    }
  }
}

const gitView = new DesktopGitDomView(gitElements, {
  syntaxErrorTitle,
  openFile: (path) => void openFile(path, false),
});
gitController = new DesktopGitController(desktop, gitView, {
  collapsed: () => layoutController.gitCollapsed,
  toggleCollapsed: () =>
    layoutController.setGitCollapsed(!layoutController.gitCollapsed),
  hasConfiguredModel: () => Boolean(configuration().model),
  openSettings,
  requestConfirmation,
  appendTerminal,
  notify,
  refreshFiles: loadFiles,
  renderTerminalPrompt,
});
gitController.bind();

layoutController = new DesktopLayoutController(
  {
    document,
    workbench,
    sidebar,
    editorArea,
    centerSurface,
    editor,
    browserPanel,
    agentsPanel,
    chatArea,
    chatSplitter,
    toggleChat,
    showChatPanel,
    toggleChatDock,
    gitPanel: gitElements.panel,
    gitBody: gitElements.body,
    filesSection,
    historySection,
    terminal,
    sidebarSplitter: element<HTMLDivElement>("sidebarSplitter"),
    gitSplitter: element<HTMLDivElement>("gitSplitter"),
    historySplitter: element<HTMLDivElement>("historySplitter"),
    terminalSplitter: element<HTMLDivElement>("terminalSplitter"),
  },
  { renderAgents, renderGit: () => gitController.render() },
);
layoutController.bind();

element<HTMLButtonElement>("chooseWorkspace").onclick = async () => {
  const next = await desktop.chooseWorkspace();
  if (!next) return;
  rendererState.desktop = next;
  editorController.reset();
  workspaceFilesController.reset();
  fileSearch.value = "";
  setCenterView("editor");
  editorTitle.textContent = "Workspace";
  renderEditorTabs();
  renderEditorContent(undefined);
  await Promise.all([
    loadFiles(),
    gitController.refresh(),
    desktop.getPlan().then((plan) => {
      activePlan = plan;
      renderPlan();
    }),
  ]);
  await restoreWorkspaceUiState();
  renderConversations();
  renderChat();
  renderRuntime();
};
element<HTMLButtonElement>("refreshFiles").onclick = () => void loadFiles();
fileSearch.oninput = () => {
  workspaceFilesController.query = fileSearch.value;
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
    workspaceFilesController.query = "";
    renderFiles();
  }
};
clearFileSearch.onclick = () => {
  fileSearch.value = "";
  workspaceFilesController.query = "";
  renderFiles();
  fileSearch.focus();
};
element<HTMLButtonElement>("newChat").onclick = () => {
  cancelActiveRunForNavigation();
  createConversation();
  finishConversationNavigation();
};
fileDiffToggle.onclick = () => {
  const path = activeWorkspaceFilePath();
  setCenterView("editor");
  if (path) void openFile(path, !editorController.showingDiff, true);
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
    void desktop
      .adjustZoom(direction)
      .then((zoomFactor) => {
        rendererState.desktop = { ...rendererState.desktop, zoomFactor };
        notify(`Zoom: ${Math.round(zoomFactor * 100)}%`);
      })
      .catch((error: unknown) =>
        notify(error instanceof Error ? error.message : String(error)),
      );
  },
  { passive: false, capture: true },
);
element<HTMLButtonElement>("settingsButton").onclick = openSettings;
toggleChat.onclick = () => setChatCollapsed(!layoutController.chatCollapsed);
showChatPanel.onclick = () => {
  setChatCollapsed(false);
  if (layoutController.chatDocked) setCenterView("chat");
};
toggleChatDock.onclick = () => setChatDocked(!layoutController.chatDocked);
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
        desktop.configureUpdates({
          checkOnLaunch: checkUpdatesOnLaunch.checked,
          autoDownload: autoDownloadUpdates.checked,
        }),
      )
      .then((returned) => {
        rendererState.desktop = returned;
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
  void desktop
    .clearCredential(
      byokProviderSelect.value as DesktopProvider,
      settingsController.selectedProviderAccountId,
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
  void desktop
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
  settingsController.createProviderAccount();
  apiKeyInput.value = "";
  renderProviderAccounts();
  providerAccountLabel.focus();
};
providerAccountSelect.onchange = () => {
  settingsController.selectProviderAccount(
    providerAccountSelect.value || undefined,
  );
  apiKeyInput.value = "";
  rendererState.setModels("cloud", []);
  renderByokModels();
  renderProviderAccounts(settingsController.selectedProviderAccountId);
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
  void desktop
    .saveProviderAccount(
      {
        id: settingsController.creatingProviderAccount
          ? undefined
          : settingsController.selectedProviderAccountId,
        providerId: provider,
        label,
        authMethod: "api-key",
      },
      apiKey,
    )
    .then((returned) => {
      rendererState.desktop = returned;
      settingsController.creatingProviderAccount = false;
      const saved = providerAccountsFor(provider).find(
        (account) =>
          account.id === settingsController.selectedProviderAccountId ||
          (!previousAccountIds.has(account.id) && account.label === label),
      );
      settingsController.selectedProviderAccountId =
        saved?.id ?? settingsController.selectedProviderAccountId;
      apiKeyInput.value = "";
      renderProviderAccounts(settingsController.selectedProviderAccountId);
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
  const accountId = settingsController.selectedProviderAccountId;
  if (!accountId) return;
  deleteProviderAccount.disabled = true;
  void desktop
    .deleteProviderAccount(accountId)
    .then((returned) => {
      rendererState.desktop = returned;
      settingsController.selectProviderAccount();
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
  const name = (settingsController.editingMcpName ?? mcpNameInput.value).trim();
  const command = mcpCommandInput.value.trim();
  if (!name || !command) {
    notify("Enter a name and command for the MCP server.");
    return;
  }
  if (!settingsController.editingMcpName && settingsController.mcpDraft[name]) {
    notify(`An MCP server named ${name} already exists.`);
    return;
  }
  const previous = settingsController.editingMcpName
    ? settingsController.mcpDraft[settingsController.editingMcpName]
    : undefined;
  settingsController.saveMcpServer(name, {
    command,
    args: mcpArgsInput.value
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean),
    cwd: mcpCwdInput.value.trim() || undefined,
    enabled: mcpEnabledInput.checked,
    readOnly: mcpReadOnlyInput.checked,
    ...(previous?.env ? { env: previous.env } : {}),
  });
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
  if (!button || !name || !action || !settingsController.mcpDraft[name]) return;
  if (action === "edit") {
    openMcpEditor(name);
    return;
  }
  if (action === "toggle") {
    settingsController.toggleMcpServer(name);
    syncMcpAdvancedJson();
    renderMcpManager();
    return;
  }
  if (action === "remove") {
    const editing = settingsController.editingMcpName === name;
    settingsController.removeMcpServer(name);
    syncMcpAdvancedJson();
    if (editing) closeMcpEditor();
    renderMcpManager();
    return;
  }
  if (action === "test") {
    button.disabled = true;
    settingsController.recordMcpStatus({
      name,
      state: "connecting",
      toolCount: 0,
    });
    renderMcpManager();
    void desktop
      .testMcpServer(name, settingsController.mcpDraft[name])
      .then((status) => settingsController.recordMcpStatus(status))
      .catch(() =>
        settingsController.recordMcpStatus({
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
    settingsController.mcpDraft = parseMcpConfigurations(mcpServersInput.value);
    settingsController.testedMcpStatuses.clear();
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
    applyDesktopTheme(document.documentElement, {
      name: "custom",
      custom:
        rendererState.desktop.theme.name === "custom"
          ? rendererState.desktop.theme.custom
          : {},
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
    applyDesktopTheme(document.documentElement, {
      name: "custom",
      custom: parseCustomThemePalette(customThemeInput.value),
    });
  } catch {
    /* Keep the previous preview until the JSON is valid. */
  }
};
saveCustomTheme.onclick = () => {
  try {
    void saveTheme({
      name: "custom",
      custom: parseCustomThemePalette(customThemeInput.value),
    }).catch((error: unknown) =>
      notify(error instanceof Error ? error.message : String(error)),
    );
  } catch (error) {
    notify(error instanceof Error ? error.message : String(error));
  }
};
openUpdateSettings.onclick = () => {
  updateAvailableDialog.close();
  if (activeEditorTab()?.mode !== "settings") openSettings();
  setSettingsTab("other");
  window.requestAnimationFrame(() => {
    document
      .querySelector<HTMLElement>(".update-settings")
      ?.scrollIntoView({ block: "nearest" });
  });
};
checkUpdates.onclick = () =>
  void desktop.checkForUpdates().catch((error) =>
    renderUpdate({
      type: "update",
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    }),
  );
downloadUpdate.onclick = () =>
  void desktop.downloadUpdate().catch((error) =>
    renderUpdate({
      type: "update",
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    }),
  );
installUpdate.onclick = () => {
  void desktop.installUpdate().catch((error) =>
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
  settingsController.selectProviderAccount();
  apiKeyInput.value = "";
  rendererState.setModels("cloud", []);
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
      : (selectedModelContextWindow(next) ?? 8_192),
    modelContextWindow: isLocalProvider(current.provider)
      ? undefined
      : selectedModelContextWindow(next),
  }).catch((error) =>
    notify(error instanceof Error ? error.message : String(error)),
  );
};
document
  .querySelectorAll<HTMLButtonElement>("[data-mode]")
  .forEach((button) => {
    button.onclick = () =>
      void applyConfiguration({
        ...configuration(),
        mode: button.dataset.mode as DesktopConfiguration["mode"],
      }).catch((error) =>
        notify(error instanceof Error ? error.message : String(error)),
      );
  });
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
  chatController.resetSlashSelection();
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
  if (slashMenu.hidden || !chatController.slashResults.length) return;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    chatController.moveSlashSelection(1);
    renderSlashMenu();
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    chatController.moveSlashSelection(-1);
    renderSlashMenu();
  }
  const selectedSlashFile = chatController.selectedSlashFile();
  if ((event.key === "Enter" || event.key === "Tab") && selectedSlashFile) {
    event.preventDefault();
    insertSlashFile(selectedSlashFile.path);
  }
  if (event.key === "Escape") {
    slashMenu.hidden = true;
  }
};
cancelChatButton.onclick = () => void desktop.stopChat();
const terminalInput = element<HTMLInputElement>("terminalInput");

function interruptTerminal(): void {
  void desktop
    .stopTerminal()
    .then((stopped) => {
      if (!stopped) {
        notify("No Truss terminal process is running.");
        return;
      }
      appendTerminal(
        `^C\n[stopping ${stopped} terminal process${stopped === 1 ? "" : "es"}]\n`,
      );
    })
    .catch((error: unknown) =>
      notify(error instanceof Error ? error.message : String(error)),
    );
}

terminalInput.onkeydown = (event) => {
  if (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    event.key.toLowerCase() === "c" &&
    terminalInput.selectionStart === terminalInput.selectionEnd
  ) {
    event.preventDefault();
    interruptTerminal();
  }
};

element<HTMLFormElement>("terminalForm").onsubmit = (event) => {
  event.preventDefault();
  const command = terminalInput.value.trim();
  if (!command) return;
  terminalInput.value = "";
  appendTerminal(`\n> ${command}\n`);
  void desktop.runTerminal(command);
};
connectTrussGo.onclick = () =>
  void desktop
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
  void desktop.disconnectTrussGo().then(() => trussGoDialog.close());
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
  void desktop
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
    layoutController.view === "editor" &&
    event.ctrlKey &&
    event.key.toLowerCase() === "w" &&
    editorController.activePath
  ) {
    event.preventDefault();
    closeEditorTab(editorController.activePath);
    return;
  }
  if (
    layoutController.view === "editor" &&
    event.ctrlKey &&
    event.key === "Tab" &&
    openEditorTabs.length > 1
  ) {
    event.preventDefault();
    const current = openEditorTabs.findIndex(
      (tab) => tab.path === editorController.activePath,
    );
    const direction = event.shiftKey ? -1 : 1;
    selectEditorTab(
      openEditorTabs[
        (current + direction + openEditorTabs.length) % openEditorTabs.length
      ],
    );
    return;
  }
  if (
    layoutController.view === "preview" &&
    event.ctrlKey &&
    event.key.toLowerCase() === "l"
  ) {
    event.preventDefault();
    browserUrl.focus();
    browserUrl.select();
  }
  if (layoutController.view === "preview" && event.key === "F5") {
    event.preventDefault();
    if (browserView.getURL() !== "about:blank") browserView.reload();
  }
  if (layoutController.view === "preview" && event.key === "F12") {
    event.preventDefault();
    browserView.openDevTools();
  }
});

desktop.onEvent(handleEvent);
window.setInterval(renderTerminalPrompt, 1_000);
void (async () => {
  [rendererState.desktop, rendererState.credentialStorage] = await Promise.all([
    desktop.initialState(),
    desktop.credentialStorage(),
  ]);
  agentsSnapshot = await desktop.listAgents();
  markChangedAgentRuns(agentsSnapshot, reflectedManagedAgentRunIds);
  chatController.restoreActivities(rendererState.desktop.conversations);
  applyDesktopTheme(document.documentElement, rendererState.desktop.theme);
  populateSettings();
  if (rendererState.desktop.runtimeError) {
    openSettings();
    notify(rendererState.desktop.runtimeError);
  }
  await discover(rendererState.desktop.configuration);
  await Promise.all([
    loadFiles(),
    gitController.refresh(),
    desktop.getPlan().then((plan) => {
      activePlan = plan;
      renderPlan();
    }),
  ]);
  await restoreWorkspaceUiState();
  layoutController.resetSidebarTracks();
  renderConversations();
  renderChat();
  renderRuntime();
})();
