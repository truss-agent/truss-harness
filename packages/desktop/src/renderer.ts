import type { WorkspacePlan } from "@truss-harness/runtime";
import type { DesktopConfiguration, DesktopConversation, DesktopEndpoint, DesktopEvent, DesktopFile, DesktopGitStatus, DesktopMessage, DesktopState } from "./shared.js";

declare global {
  interface Window {
    trussDesktop: import("./shared.js").DesktopBridge;
  }
}

interface EmbeddedBrowserView extends HTMLElement {
  loadURL(url: string): Promise<void>;
  getURL(): string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
}

const defaultConfiguration: DesktopConfiguration = {
  provider: "ollama",
  baseUrl: "http://127.0.0.1:11434",
  model: "",
  mode: "chat",
  permission: "ask",
  contextWindow: 8_192,
  internetAccess: false
};

const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const fileTree = element<HTMLDivElement>("fileTree");
const conversations = element<HTMLDivElement>("conversationList");
const workbench = document.querySelector<HTMLElement>(".workbench") as HTMLElement;
const sidebar = document.querySelector<HTMLElement>(".sidebar") as HTMLElement;
const editorArea = document.querySelector<HTMLElement>(".editor-area") as HTMLElement;
const filesSection = document.querySelector<HTMLElement>(".files-section") as HTMLElement;
const historySection = document.querySelector<HTMLElement>(".history-section") as HTMLElement;
const centerSurface = element<HTMLElement>("centerSurface");
const editorContent = document.querySelector<HTMLElement>(".editor-content") as HTMLElement;
const terminal = document.querySelector<HTMLElement>(".terminal") as HTMLElement;
const gitPanel = element<HTMLElement>("gitPanel");
const gitBody = element<HTMLDivElement>("gitBody");
const gitBranch = element<HTMLSpanElement>("gitBranch");
const gitCounts = element<HTMLSpanElement>("gitCounts");
const gitFiles = element<HTMLDivElement>("gitFiles");
const commitMessage = element<HTMLInputElement>("commitMessage");
const generateCommitMessage = element<HTMLButtonElement>("generateCommitMessage");
const editor = element<HTMLPreElement>("editor");
const editorTabsElement = element<HTMLDivElement>("editorTabs");
const editorTitle = element<HTMLSpanElement>("editorTitle");
const browserPanel = element<HTMLElement>("browserPanel");
const browserView = element<EmbeddedBrowserView>("browserView");
const browserUrl = element<HTMLInputElement>("browserUrl");
const browserBack = element<HTMLButtonElement>("browserBack");
const browserForward = element<HTMLButtonElement>("browserForward");
const browserReload = element<HTMLButtonElement>("browserReload");
const browserExternal = element<HTMLButtonElement>("browserExternal");
const devServerCommand = element<HTMLInputElement>("devServerCommand");
const devServerStatus = element<HTMLSpanElement>("devServerStatus");
const startDevServer = element<HTMLButtonElement>("startDevServer");
const stopDevServer = element<HTMLButtonElement>("stopDevServer");
const terminalOutput = element<HTMLPreElement>("terminalOutput");
const chatMessages = element<HTMLDivElement>("chatMessages");
const planPanel = element<HTMLElement>("planPanel");
const chatInput = element<HTMLTextAreaElement>("chatInput");
const sendChatButton = element<HTMLButtonElement>("sendChat");
const cancelChatButton = element<HTMLButtonElement>("cancelChat");
const slashMenu = element<HTMLDivElement>("slashMenu");
const chatStatus = element<HTMLSpanElement>("chatStatus");
const stopChat = element<HTMLButtonElement>("stopChat");
const runtimeStatus = element<HTMLSpanElement>("runtimeStatus");
const statusDot = element<HTMLSpanElement>("statusDot");
const quickModel = element<HTMLSelectElement>("quickModel");
const contextMeter = element<HTMLSpanElement>("contextMeter");
// Keep older packaged HTML usable when only the renderer bundle has been refreshed.
const rateMeter = document.getElementById("rateMeter") as HTMLSpanElement | null;
const settingsDialog = element<HTMLDialogElement>("settingsDialog");
const endpointSelect = element<HTMLSelectElement>("endpointSelect");
const providerSelect = element<HTMLSelectElement>("providerSelect");
const baseUrlInput = element<HTMLInputElement>("baseUrlInput");
const modelInput = element<HTMLInputElement>("modelInput");
const modelOptions = element<HTMLDataListElement>("modelOptions");
const contextInput = element<HTMLInputElement>("contextInput");
const permissionSelect = element<HTMLSelectElement>("permissionSelect");
const internetAccessInput = element<HTMLInputElement>("internetAccessInput");
const toast = element<HTMLDivElement>("toast");

let desktopState: DesktopState = { workspaceRoot: "", conversations: [] };
let endpoints: readonly DesktopEndpoint[] = [];
let models: readonly string[] = [];
let files: readonly DesktopFile[] = [];
let activeFile: string | undefined;
let showingDiff = false;
type EditorTabMode = "file" | "diff";
type EditorTabState = "loading" | "ready" | "error";
interface EditorTab {
  readonly path: string;
  mode: EditorTabMode;
  state: EditorTabState;
  content: string;
  scrollTop: number;
  revision: number;
}
const openEditorTabs: EditorTab[] = [];
let busy = false;
let persistTimer: number | undefined;
let slashResults: readonly DesktopFile[] = [];
let slashIndex = 0;
const collapsedDirectories = new Set<string>();
let gitStatus: DesktopGitStatus = { available: false, ahead: 0, behind: 0, files: [] };
let gitCollapsed = false;
let gitPanelHeight = 220;
let activePlan: WorkspacePlan | undefined;
let streamStartedAt = 0;
let streamedTokenEstimate = 0;
let runningConversationId: string | undefined;
let centerView: "editor" | "preview" = "editor";

function configuration(): DesktopConfiguration {
  return desktopState.configuration ?? defaultConfiguration;
}

function activeConversation(): DesktopConversation | undefined {
  return desktopState.conversations.find((conversation) => conversation.id === desktopState.activeConversationId);
}

function conversationById(id: string | undefined): DesktopConversation | undefined {
  return id ? desktopState.conversations.find((conversation) => conversation.id === id) : undefined;
}

function createId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function tokenEstimate(messages: readonly DesktopMessage[]): number {
  return messages.reduce((total, message) => total + Math.ceil(message.content.trim().length / 4), 400);
}

function formatTokens(value: number): string {
  return value >= 1_000 ? `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k` : String(Math.round(value));
}

function notify(message: string): void {
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 2_800);
}

function normalizedPreviewUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Enter a preview URL.");
  const normalized = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const url = new URL(normalized);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Preview URLs must use HTTP or HTTPS.");
  return url.toString();
}

function setCenterView(next: "editor" | "preview"): void {
  centerView = next;
  editor.hidden = next !== "editor";
  browserPanel.hidden = next !== "preview";
  document.querySelectorAll<HTMLButtonElement>("[data-center-view]").forEach((button) => button.classList.toggle("active", button.dataset.centerView === next));
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
  void browserView.loadURL(url).catch((error: unknown) => notify(error instanceof Error ? error.message : String(error)));
}

function renderDevServer(status: "starting" | "running" | "stopped" | "failed", message?: string): void {
  devServerStatus.textContent = status === "starting" ? "Starting" : status === "running" ? "Running" : status === "failed" ? "Failed" : "Stopped";
  devServerStatus.className = `dev-server-status ${status}`;
  startDevServer.disabled = status === "starting" || status === "running";
  stopDevServer.disabled = status === "stopped" || status === "failed";
  if (message && status === "failed") notify(message);
}

function saveConversations(): void {
  window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    void window.trussDesktop.saveConversations(desktopState.conversations, desktopState.activeConversationId);
  }, 220);
}

function setBusy(next: boolean): void {
  if (next && !busy) {
    streamStartedAt = performance.now();
    streamedTokenEstimate = 0;
  }
  busy = next;
  stopChat.disabled = !next;
  sendChatButton.hidden = next;
  cancelChatButton.hidden = !next;
  chatStatus.textContent = next ? "Streaming" : "Ready";
  statusDot.className = `status-dot ${next ? "busy" : desktopState.configuration?.model ? "ready" : ""}`;
  renderRuntime();
}

function cancelActiveRunForNavigation(): void {
  if (!busy) return;
  const running = conversationById(runningConversationId);
  if (running) {
    updateConversation(running.id, (current) => ({ ...current, lastRun: { status: "failed", modifiedFiles: [], completedAt: new Date().toISOString() } }));
  }
  runningConversationId = undefined;
  setBusy(false);
  void window.trussDesktop.stopChat();
}

function renderRuntime(): void {
  const config = desktopState.configuration;
  runtimeStatus.textContent = config?.model ? `${config.provider} / ${config.model}` : "No model selected";
  statusDot.className = `status-dot ${busy ? "busy" : config?.model ? "ready" : ""}`;
  document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((button) => button.classList.toggle("active", button.dataset.mode === configuration().mode));
  const values = [...new Set([config?.model, ...models].filter((value): value is string => Boolean(value)))];
  quickModel.replaceChildren(...values.map((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    return option;
  }));
  quickModel.value = config?.model ?? "";
  const used = tokenEstimate(activeConversation()?.messages ?? []);
  contextMeter.textContent = `Context ${formatTokens(used)} / ${formatTokens(configuration().contextWindow)} est.`;
  const elapsed = streamStartedAt ? (performance.now() - streamStartedAt) / 1_000 : 0;
  if (rateMeter) rateMeter.textContent = streamedTokenEstimate && elapsed > 0 ? `Speed ${(streamedTokenEstimate / elapsed).toFixed(1)} tok/s` : "Speed -- tok/s";
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

function sidebarTracks(): { readonly git: number; readonly files: number; readonly history: number } {
  return {
    git: gitPanel.getBoundingClientRect().height,
    files: filesSection.getBoundingClientRect().height,
    history: historySection.getBoundingClientRect().height
  };
}

function applySidebarTracks(git: number, files: number, history: number): void {
  sidebar.style.setProperty("--git-height", `${git}px`);
  sidebar.style.setProperty("--files-height", `${files}px`);
  sidebar.style.setProperty("--history-height", `${history}px`);
}

function setGitCollapsed(collapsed: boolean): void {
  if (gitCollapsed === collapsed) return;
  const tracks = sidebarTracks();
  const desiredGit = collapsed ? 38 : gitPanelHeight;
  const applied = clamp(desiredGit - tracks.git, 110 - tracks.files, Number.MAX_SAFE_INTEGER);
  if (!collapsed) gitPanelHeight = tracks.git + applied;
  gitCollapsed = collapsed;
  renderGit();
  applySidebarTracks(collapsed ? 38 : gitPanelHeight, tracks.files - applied, tracks.history);
}

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
    gitFiles.replaceChildren();
    return;
  }
  gitBranch.textContent = gitStatus.branch || "No branch yet";
  gitCounts.textContent = [gitStatus.ahead ? `up ${gitStatus.ahead}` : "", gitStatus.behind ? `down ${gitStatus.behind}` : "", `${gitStatus.files.length} changed`].filter(Boolean).join(" | ");
  gitFiles.replaceChildren(...gitStatus.files.map((file) => {
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
    row.append(status, open);
    if (file.indexStatus !== " " && file.indexStatus !== "?") {
      const unstage = document.createElement("button");
      unstage.className = "git-row-action";
      unstage.textContent = "-";
      unstage.title = `Unstage ${file.path}`;
      unstage.setAttribute("aria-label", `Unstage ${file.path}`);
      unstage.onclick = () => void runGitAction("unstage", () => window.trussDesktop.gitUnstage([file.path]));
      row.append(unstage);
    }
    if (file.workTreeStatus !== " " || file.indexStatus === "?") {
      const stage = document.createElement("button");
      stage.className = "git-row-action";
      stage.textContent = "+";
      stage.title = `Stage ${file.path}`;
      stage.setAttribute("aria-label", `Stage ${file.path}`);
      stage.onclick = () => void runGitAction("stage", () => window.trussDesktop.gitStage([file.path]));
      row.append(stage);
    }
    return row;
  }));
}

async function refreshGit(): Promise<void> {
  gitStatus = await window.trussDesktop.gitStatus();
  renderGit();
}

async function runGitAction(action: string, run: () => Promise<string>): Promise<void> {
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
  fileTree.replaceChildren();
  if (!files.length) {
    const empty = document.createElement("div");
    empty.className = "empty-chat";
    empty.textContent = "No files loaded.";
    fileTree.append(empty);
    return;
  }
  interface TreeNode { readonly directories: Map<string, TreeNode>; readonly files: DesktopFile[]; }
  const root: TreeNode = { directories: new Map(), files: [] };
  for (const file of files) {
    const parts = file.path.split(/[\\/]/).filter(Boolean);
    const fileName = parts.pop();
    if (!fileName) continue;
    let node = root;
    for (const part of parts) {
      let child = node.directories.get(part);
      if (!child) {
        child = { directories: new Map(), files: [] };
        node.directories.set(part, child);
      }
      node = child;
    }
    node.files.push(file);
  }
  const renderNode = (node: TreeNode, path: string, depth: number): void => {
    const directories = [...node.directories.entries()].sort(([left], [right]) => left.localeCompare(right));
    for (const [name, child] of directories) {
      const directoryPath = path ? `${path}/${name}` : name;
      const row = document.createElement("div");
      row.className = "tree-row directory";
      row.style.setProperty("--depth", String(depth));
      const button = document.createElement("button");
      const expanded = !collapsedDirectories.has(directoryPath);
      button.className = "folder-button";
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
      button.onclick = () => {
        if (expanded) collapsedDirectories.add(directoryPath);
        else collapsedDirectories.delete(directoryPath);
        renderFiles();
      };
      row.append(button);
      fileTree.append(row);
      if (expanded) renderNode(child, directoryPath, depth + 1);
    }
    for (const file of [...node.files].sort((left, right) => left.path.localeCompare(right.path))) {
      const row = document.createElement("div");
      row.className = "tree-row file";
      row.style.setProperty("--depth", String(depth));
      const button = document.createElement("button");
      button.textContent = file.path.split(/[\\/]/).at(-1) ?? file.path;
      button.title = file.path;
      if (file.path === activeFile) button.classList.add("active");
      button.onclick = () => void openFile(file.path, false);
      row.append(button);
      fileTree.append(row);
    }
  };
  renderNode(root, "", 0);
}

function renderConversations(): void {
  conversations.replaceChildren();
  desktopState.conversations.forEach((conversation) => {
    const row = document.createElement("div");
    row.className = "conversation-row";
    const select = document.createElement("button");
    select.textContent = conversation.title;
    select.title = conversation.title;
    if (conversation.id === desktopState.activeConversationId) select.classList.add("active");
    select.onclick = () => {
      if (conversation.id !== desktopState.activeConversationId) cancelActiveRunForNavigation();
      desktopState = { ...desktopState, activeConversationId: conversation.id };
      renderConversations();
      renderChat();
      renderRuntime();
      saveConversations();
    };
    const remove = document.createElement("button");
    remove.className = "delete";
    remove.textContent = "x";
    remove.title = "Delete conversation";
    remove.onclick = () => {
      if (!window.confirm(`Delete "${conversation.title}"?`)) return;
      if (conversation.id === desktopState.activeConversationId) cancelActiveRunForNavigation();
      const remaining = desktopState.conversations.filter((item) => item.id !== conversation.id);
      desktopState = { ...desktopState, conversations: remaining, activeConversationId: desktopState.activeConversationId === conversation.id ? remaining[0]?.id : desktopState.activeConversationId };
      renderConversations();
      renderChat();
      renderRuntime();
      saveConversations();
    };
    row.append(select, remove);
    conversations.append(row);
  });
}

function appendInlineMarkdown(parent: HTMLElement, text: string): void {
  const token = /(`[^`]*`)|(\[([^\]]+)\]\(([^\s)]+)\))|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)/g;
  let cursor = 0;
  for (const match of text.matchAll(token)) {
    const index = match.index ?? 0;
    if (index > cursor) parent.append(document.createTextNode(text.slice(cursor, index)));
    if (match[1]) {
      const code = document.createElement("code");
      code.textContent = match[1].slice(1, -1);
      parent.append(code);
    } else if (match[2]) {
      const link = document.createElement("a");
      const href = match[4] ?? "";
      link.textContent = match[3] ?? href;
      if (/^(https?:|mailto:)/i.test(href)) {
        link.href = href;
        link.target = "_blank";
        link.rel = "noreferrer";
      }
      parent.append(link);
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
  if (cursor < text.length) parent.append(document.createTextNode(text.slice(cursor)));
}

function appendHighlightedCode(parent: HTMLElement, code: string, language = ""): void {
  if (/^(?:html|xml|svg|vue|svelte)$/i.test(language)) {
    const markupToken = /(<!--[\s\S]*?-->)|(<\/?[A-Za-z][^>]*>)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g;
    let markupCursor = 0;
    for (const match of code.matchAll(markupToken)) {
      const index = match.index ?? 0;
      if (index > markupCursor) parent.append(document.createTextNode(code.slice(markupCursor, index)));
      const span = document.createElement("span");
      span.className = match[1] ? "token-comment" : match[2] ? "token-tag" : "token-string";
      span.textContent = match[0];
      parent.append(span);
      markupCursor = index + match[0].length;
    }
    if (markupCursor < code.length) parent.append(document.createTextNode(code.slice(markupCursor)));
    return;
  }

  const token = /(\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b(?:as|async|await|break|case|catch|class|const|continue|def|default|delete|do|else|enum|export|extends|false|finally|fn|for|from|function|if|implements|import|in|instanceof|interface|let|match|new|null|package|private|protected|public|return|static|super|switch|this|throw|true|try|type|typeof|undefined|use|var|while|yield)\b)|(\b(?:0x[\da-f]+|\d+(?:\.\d+)?)\b)|([{}()[\].,:;=+\-*/<>!?&|]+)/gi;
  let cursor = 0;
  for (const match of code.matchAll(token)) {
    const index = match.index ?? 0;
    if (index > cursor) parent.append(document.createTextNode(code.slice(cursor, index)));
    const span = document.createElement("span");
    span.className = match[1] ? "token-comment" : match[2] ? "token-string" : match[3] ? "token-keyword" : match[4] ? "token-number" : "token-operator";
    span.textContent = match[0];
    parent.append(span);
    cursor = index + match[0].length;
  }
  if (cursor < code.length) parent.append(document.createTextNode(code.slice(cursor)));
}

function renderMarkdown(container: HTMLElement, content: string): void {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    const fence = line.match(/^```([^\s]*)\s*$/);
    if (fence) {
      const language = fence[1] || "text";
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) code.push(lines[index++]);
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
      const element = document.createElement(`h${heading[1].length}`) as HTMLHeadingElement;
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
    if (!line.trim()) { index += 1; continue; }
    const paragraph = document.createElement("p");
    const paragraphLines = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !/^(#{1,4}\s|```|[-*+]\s+|>\s?)/.test(lines[index])) paragraphLines.push(lines[index++]);
    appendInlineMarkdown(paragraph, paragraphLines.join("\n"));
    container.append(paragraph);
  }
}

function messageView(message: DesktopMessage): HTMLElement {
  const view = document.createElement("div");
  view.className = `message ${message.role}`;
  const role = document.createElement("span");
  role.className = "role";
  role.textContent = message.role === "user" ? "YOU" : "AGENT";
  const content = document.createElement("div");
  content.className = "markdown";
  if (!message.content && busy && message.role === "assistant") {
    content.className = "thinking";
    content.textContent = "Thinking...";
  } else {
    renderMarkdown(content, message.content);
  }
  view.append(role, content);
  return view;
}

function renderChat(): void {
  chatMessages.replaceChildren();
  const conversation = activeConversation();
  if (!conversation || !conversation.messages.length) {
    const empty = document.createElement("div");
    empty.className = "empty-chat";
    empty.textContent = "Select a local model, then ask about the workspace. Plan is read-only; Agent can edit files and run commands.";
    chatMessages.append(empty);
    return;
  }
  conversation.messages.forEach((message) => chatMessages.append(messageView(message)));
  if (conversation.lastRun) {
    const result = document.createElement("div");
    result.className = `run-result ${conversation.lastRun.status}`;
    if (conversation.lastRun.status === "running") {
      result.textContent = "Working...";
    } else if (conversation.lastRun.status === "failed") {
      result.textContent = "Run did not complete. No file changes are verified.";
    } else if (conversation.lastRun.modifiedFiles.length) {
      result.textContent = `Verified workspace changes: ${conversation.lastRun.modifiedFiles.join(", ")}`;
    } else {
      result.textContent = "No workspace file changes were verified.";
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
  const conversation: DesktopConversation = { id: createId(), title: "New conversation", messages: [], updatedAt: new Date().toISOString() };
  desktopState = { ...desktopState, conversations: [conversation, ...desktopState.conversations], activeConversationId: conversation.id };
  return conversation;
}

function ensureConversation(): DesktopConversation {
  return activeConversation() ?? createConversation();
}

function updateConversation(conversationId: string, update: (conversation: DesktopConversation) => DesktopConversation): void {
  desktopState = { ...desktopState, conversations: desktopState.conversations.map((conversation) => conversation.id === conversationId ? update(conversation) : conversation) };
}

function languageForPath(path: string): string {
  const extension = path.split(".").at(-1)?.toLowerCase() ?? "";
  const languages: Record<string, string> = {
    cjs: "javascript", css: "css", go: "go", htm: "html", html: "html", java: "java",
    js: "javascript", json: "json", jsx: "jsx", md: "markdown", mjs: "javascript",
    php: "php", py: "python", rb: "ruby", rs: "rust", scss: "scss", sh: "shell",
    sql: "sql", svelte: "svelte", svg: "svg", toml: "toml", ts: "typescript",
    tsx: "tsx", vue: "vue", xml: "xml", yaml: "yaml", yml: "yaml"
  };
  return languages[extension] ?? extension;
}

function mediaKindForPath(path: string): "image" | "video" | undefined {
  const extension = path.split(".").at(-1)?.toLowerCase();
  if (extension && ["jpg", "jpeg", "png", "svg", "webp"].includes(extension)) return "image";
  if (extension && ["mp4", "webm"].includes(extension)) return "video";
  return undefined;
}

function workspaceMediaUrl(path: string): string {
  return `truss-media://workspace/${encodeURIComponent(path.replaceAll("\\", "/"))}`;
}

function activeEditorTab(): EditorTab | undefined {
  return activeFile ? openEditorTabs.find((tab) => tab.path === activeFile) : undefined;
}

function preserveEditorScroll(): void {
  const tab = activeEditorTab();
  if (tab) tab.scrollTop = editor.scrollTop;
}

function renderEditorContent(tab: EditorTab | undefined): void {
  editor.className = "editor-content";
  editor.replaceChildren();
  if (!tab) {
    editor.append(document.createTextNode("Open a workspace file to inspect it."));
    editor.scrollTop = 0;
    return;
  }
  if (tab.state === "loading") {
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
      if (line.startsWith("+") && !line.startsWith("+++")) row.classList.add("added");
      else if (line.startsWith("-") && !line.startsWith("---")) row.classList.add("removed");
      else if (line.startsWith("@@")) row.classList.add("hunk");
      const marker = document.createElement("span");
      marker.className = "diff-marker";
      marker.textContent = line[0] === "+" || line[0] === "-" || line[0] === " " ? line[0] : " ";
      const code = document.createElement("span");
      appendHighlightedCode(code, marker.textContent.trim() ? line.slice(1) : line, language);
      row.append(marker, code);
      editor.append(row);
    }
  } else {
    appendHighlightedCode(editor, tab.content, languageForPath(tab.path));
  }
  window.requestAnimationFrame(() => { editor.scrollTop = tab.scrollTop; });
}

function selectEditorTab(tab: EditorTab): void {
  preserveEditorScroll();
  activeFile = tab.path;
  showingDiff = tab.mode === "diff";
  setCenterView("editor");
  renderEditorTabs();
  renderEditorContent(tab);
  renderFiles();
}

function closeEditorTab(path: string): void {
  const index = openEditorTabs.findIndex((tab) => tab.path === path);
  if (index < 0) return;
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
    renderFiles();
  }
  renderEditorTabs();
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
    select.textContent = tab.path.split(/[\\/]/).at(-1) ?? tab.path;
    select.title = `${tab.mode === "diff" ? "Diff: " : ""}${tab.path}`;
    select.onclick = () => selectEditorTab(tab);
    const close = document.createElement("button");
    close.className = "editor-tab-close";
    close.type = "button";
    close.textContent = "x";
    close.title = `Close ${tab.path}`;
    close.setAttribute("aria-label", `Close ${tab.path}`);
    close.onclick = () => closeEditorTab(tab.path);
    container.append(select, close);
    return container;
  });
  editorTabsElement.replaceChildren(editorTitle, ...tabs);
}

async function loadEditorTab(tab: EditorTab): Promise<void> {
  const revision = ++tab.revision;
  tab.state = "loading";
  if (tab.path === activeFile) renderEditorContent(tab);
  try {
    const content = tab.mode === "file" && mediaKindForPath(tab.path)
      ? ""
      : tab.mode === "diff" ? await window.trussDesktop.diffFile(tab.path) : await window.trussDesktop.readFile(tab.path);
    if (revision !== tab.revision) return;
    tab.content = content;
    tab.state = "ready";
  } catch (error) {
    if (revision !== tab.revision) return;
    tab.content = `Unable to open ${tab.path}: ${error instanceof Error ? error.message : String(error)}`;
    tab.state = "error";
  }
  if (tab.path === activeFile) renderEditorContent(tab);
}

async function openFile(path: string, diff: boolean): Promise<void> {
  let tab = openEditorTabs.find((candidate) => candidate.path === path);
  if (!tab) {
    tab = { path, mode: diff ? "diff" : "file", state: "loading", content: "", scrollTop: 0, revision: 0 };
    openEditorTabs.push(tab);
  } else if (tab.mode !== (diff ? "diff" : "file")) {
    tab.mode = diff ? "diff" : "file";
    tab.scrollTop = 0;
  }
  selectEditorTab(tab);
  await loadEditorTab(tab);
}

async function loadFiles(): Promise<void> {
  try {
    files = await window.trussDesktop.listFiles();
    renderFiles();
  } catch (error) {
    notify(error instanceof Error ? error.message : String(error));
  }
}

async function discover(input?: Partial<DesktopConfiguration>): Promise<void> {
  const result = await window.trussDesktop.discoverModels(input);
  endpoints = result.endpoints;
  models = result.models;
  endpointSelect.replaceChildren(...[{ id: "", label: "Custom endpoint", kind: "", baseUrl: "" }, ...endpoints].map((endpoint) => {
    const option = document.createElement("option");
    option.value = endpoint.id ? JSON.stringify(endpoint) : "";
    option.textContent = endpoint.label + (endpoint.baseUrl ? ` (${endpoint.baseUrl})` : "");
    return option;
  }));
  modelOptions.replaceChildren(...models.map((name) => {
    const option = document.createElement("option");
    option.value = name;
    return option;
  }));
  renderRuntime();
}

function settingsConfiguration(): DesktopConfiguration {
  const current = configuration();
  return {
    provider: providerSelect.value === "openai-compatible" ? "openai-compatible" : "ollama",
    baseUrl: baseUrlInput.value.trim(),
    model: modelInput.value.trim(),
    mode: current.mode,
    permission: permissionSelect.value === "auto-read" || permissionSelect.value === "auto-all" ? permissionSelect.value : "ask",
    contextWindow: Math.max(512, Number.parseInt(contextInput.value, 10) || 8_192),
    internetAccess: internetAccessInput.checked
  };
}

function populateSettings(): void {
  const current = configuration();
  providerSelect.value = current.provider;
  baseUrlInput.value = current.baseUrl;
  modelInput.value = current.model;
  contextInput.value = String(current.contextWindow);
  permissionSelect.value = current.permission;
  internetAccessInput.checked = current.internetAccess;
}

async function applyConfiguration(next: DesktopConfiguration): Promise<void> {
  const returned = await window.trussDesktop.configure(next);
  desktopState = returned;
  await discover(next);
  renderRuntime();
  notify(`Using ${next.model}`);
}

function slashQuery(): { readonly start: number; readonly query: string } | undefined {
  const beforeCursor = chatInput.value.slice(0, chatInput.selectionStart ?? chatInput.value.length);
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
    .flatMap((file) => {
      const score = fuzzyScore(file.path, query.query);
      return score === undefined ? [] : [{ file, score }];
    })
    .sort((left, right) => left.score - right.score || left.file.path.localeCompare(right.file.path))
    .slice(0, 8)
    .map(({ file }) => file);
  if (!slashResults.length) {
    slashMenu.hidden = true;
    return;
  }
  slashIndex = Math.min(slashIndex, slashResults.length - 1);
  slashMenu.replaceChildren(...slashResults.map((file, index) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = `slash-option${index === slashIndex ? " active" : ""}`;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", String(index === slashIndex));
    option.textContent = file.path;
    option.onmousedown = (event) => { event.preventDefault(); insertSlashFile(file.path); };
    return option;
  }));
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
  const available = new Set(files.map((file) => file.path));
  return [...new Set([...prompt.matchAll(/(?:^|\s)\/([^\s]+)/g)].map((match) => match[1].replaceAll("\\", "/")).filter((path) => available.has(path)))];
}

async function sendChat(): Promise<void> {
  const prompt = chatInput.value.trim();
  if (!prompt || busy) return;
  if (!configuration().model) {
    settingsDialog.showModal();
    notify("Choose a local model first.");
    return;
  }
  const conversation = ensureConversation();
  const history = conversation.messages;
  const userMessage: DesktopMessage = { role: "user", content: prompt };
  const assistantMessage: DesktopMessage = { role: "assistant", content: "" };
  const title = conversation.title === "New conversation" ? prompt.replace(/\s+/g, " ").slice(0, 42) || conversation.title : conversation.title;
  updateConversation(conversation.id, (current) => ({ ...current, title, messages: [...current.messages, userMessage, assistantMessage], updatedAt: new Date().toISOString() }));
  desktopState = { ...desktopState, activeConversationId: conversation.id };
  chatInput.value = "";
  renderConversations();
  renderChat();
  renderRuntime();
  saveConversations();
  try {
    runningConversationId = conversation.id;
    setBusy(true);
    await window.trussDesktop.sendChat({ prompt, conversationId: conversation.id, history, activeFilePath: activeFile, attachedPaths: attachedPaths(prompt) });
  } catch (error) {
    updateConversation(conversation.id, (current) => ({ ...current, messages: [...current.messages.slice(0, -1), { role: "assistant", content: `Error: ${error instanceof Error ? error.message : String(error)}` }] }));
    setBusy(false);
    renderChat();
  }
}

function appendTerminal(text: string): void {
  terminalOutput.textContent = `${terminalOutput.textContent}${text}`.slice(-50_000);
  terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

function handleEvent(message: DesktopEvent): void {
  if (message.type === "chat-start") {
    runningConversationId = message.conversationId;
    updateConversation(message.conversationId, (current) => ({ ...current, lastRun: { status: "running", modifiedFiles: [] } }));
    setBusy(true);
    renderChat();
    return;
  }
  if (message.type === "chat-end") {
    if (message.conversationId === runningConversationId) {
      runningConversationId = undefined;
      setBusy(false);
    }
    renderChat();
    return;
  }
  if (message.type === "chat-error") {
    const conversation = conversationById(message.conversationId);
    if (conversation) updateConversation(conversation.id, (current) => ({ ...current, lastRun: { status: "failed", modifiedFiles: [], completedAt: new Date().toISOString() } }));
    if (message.conversationId === runningConversationId) {
      runningConversationId = undefined;
      setBusy(false);
    }
    renderChat();
    appendToolMessage(`Error: ${message.message}`);
    return;
  }
  if (message.type === "terminal-output") { appendTerminal(message.text); return; }
  if (message.type === "dev-server") {
    renderDevServer(message.status, message.message);
    if (message.url) navigatePreview(message.url);
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
    const deny = document.createElement("button");
    deny.textContent = "Deny";
    allow.onclick = () => { void window.trussDesktop.resolveApproval(message.callId, true); approval.textContent = `Allowed ${message.tool}`; };
    deny.onclick = () => { void window.trussDesktop.resolveApproval(message.callId, false); approval.textContent = `Denied ${message.tool}`; };
    actions.append(allow, deny);
    approval.append(actions);
    chatMessages.append(approval);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return;
  }
  if (message.type !== "agent") return;
  const event = message.event;
  const conversation = conversationById(message.conversationId);
  if (event.type === "plan_updated" && event.plan) { activePlan = event.plan; renderPlan(); return; }
  if (event.type === "run_completed") {
    if (conversation) {
      updateConversation(conversation.id, (current) => ({
        ...current,
        lastRun: { status: "completed", modifiedFiles: event.modifiedFiles ?? [], completedAt: new Date().toISOString() },
        updatedAt: new Date().toISOString()
      }));
      saveConversations();
      renderChat();
    }
    const modified = new Set((event.modifiedFiles ?? []).map((path) => path.replaceAll("\\", "/")));
    for (const tab of openEditorTabs) {
      if (modified.has(tab.path.replaceAll("\\", "/"))) void loadEditorTab(tab);
    }
    if (centerView === "preview" && browserView.getURL() !== "about:blank") browserView.reload();
    return;
  }
  if (event.type === "text_delta") {
    if (!conversation) return;
    updateConversation(conversation.id, (current) => {
      const last = current.messages.at(-1);
      if (!last || last.role !== "assistant") return current;
      return { ...current, messages: [...current.messages.slice(0, -1), { role: "assistant", content: last.content + (event.text ?? "") }], updatedAt: new Date().toISOString() };
    });
    streamedTokenEstimate += Math.ceil((event.text ?? "").trim().length / 4);
    if (conversation.id === desktopState.activeConversationId) renderChat();
    renderRuntime();
    saveConversations();
  }
  if (event.type === "tool_call_requested" && conversation?.id === desktopState.activeConversationId) appendToolMessage(`Running tool: ${event.tool ?? "unknown"}`);
  if (event.type === "tool_completed") {
    const tool = event.tool ?? "tool";
    const result = event.result?.content ?? "";
    if (conversation?.id === desktopState.activeConversationId) appendToolMessage(event.result?.isError ? `${tool} failed: ${result.slice(0, 700)}` : `Completed tool: ${tool}`);
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function bindPaneResize(id: string, axis: "x" | "y", createMove: () => (delta: number) => void): void {
  const splitter = element<HTMLDivElement>(id);
  splitter.addEventListener("pointerdown", (down) => {
    down.preventDefault();
    const start = axis === "x" ? down.clientX : down.clientY;
    const move = createMove();
    document.body.classList.add("resizing");
    splitter.setPointerCapture(down.pointerId);
    const onMove = (event: PointerEvent): void => move((axis === "x" ? event.clientX : event.clientY) - start);
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
}

bindPaneResize("sidebarSplitter", "x", () => {
  const initial = sidebar.getBoundingClientRect().width;
  return (delta) => workbench.style.setProperty("--sidebar-width", `${clamp(initial + delta, 190, 520)}px`);
});
bindPaneResize("chatSplitter", "x", () => {
  const initial = document.querySelector<HTMLElement>(".chat-area")?.getBoundingClientRect().width ?? 390;
  return (delta) => workbench.style.setProperty("--chat-width", `${clamp(initial - delta, 330, 680)}px`);
});
bindPaneResize("gitSplitter", "y", () => {
  if (gitCollapsed) setGitCollapsed(false);
  const initial = sidebarTracks();
  return (delta) => {
    const applied = clamp(delta, 160 - initial.git, initial.files - 110);
    gitPanelHeight = initial.git + applied;
    applySidebarTracks(gitPanelHeight, initial.files - applied, initial.history);
  };
});
bindPaneResize("historySplitter", "y", () => {
  const initial = sidebarTracks();
  return (delta) => {
    const applied = clamp(delta, 110 - initial.files, initial.history - 110);
    applySidebarTracks(initial.git, initial.files + applied, initial.history - applied);
  };
});
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
  setCenterView("editor");
  editorTitle.textContent = "Workspace";
  renderEditorTabs();
  renderEditorContent(undefined);
  await Promise.all([loadFiles(), refreshGit(), window.trussDesktop.getPlan().then((plan) => { activePlan = plan; renderPlan(); })]);
  renderConversations();
  renderChat();
  renderRuntime();
};
element<HTMLButtonElement>("refreshModels").onclick = () => void discover({ provider: providerSelect.value === "openai-compatible" ? "openai-compatible" : "ollama", baseUrl: baseUrlInput.value || configuration().baseUrl });
element<HTMLButtonElement>("refreshFiles").onclick = () => void loadFiles();
element<HTMLButtonElement>("refreshGit").onclick = () => void refreshGit();
element<HTMLButtonElement>("toggleGit").onclick = () => setGitCollapsed(!gitCollapsed);
element<HTMLButtonElement>("stageAll").onclick = () => {
  if (!gitStatus.files.length) { notify("No changed files to stage."); return; }
  void runGitAction("stage", () => window.trussDesktop.gitStage(gitStatus.files.map((file) => file.path)));
};
element<HTMLButtonElement>("pullGit").onclick = () => void runGitAction("pull", () => window.trussDesktop.gitPull());
element<HTMLButtonElement>("pushGit").onclick = () => void runGitAction("push", () => window.trussDesktop.gitPush());
generateCommitMessage.onclick = () => {
  if (!configuration().model) {
    settingsDialog.showModal();
    notify("Choose a local model first.");
    return;
  }
  generateCommitMessage.disabled = true;
  generateCommitMessage.textContent = "Generating...";
  void window.trussDesktop.gitGenerateCommitMessage()
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
  if (!message) { notify("Enter a commit message."); return; }
  void runGitAction("commit", async () => {
    const output = await window.trussDesktop.gitCommit(message);
    commitMessage.value = "";
    return output;
  });
};
element<HTMLButtonElement>("newChat").onclick = () => { cancelActiveRunForNavigation(); createConversation(); renderConversations(); renderChat(); renderRuntime(); saveConversations(); };
element<HTMLButtonElement>("fileButton").onclick = () => { setCenterView("editor"); if (activeFile) void openFile(activeFile, false); };
element<HTMLButtonElement>("diffButton").onclick = () => { setCenterView("editor"); if (activeFile) void openFile(activeFile, !showingDiff); };
element<HTMLButtonElement>("settingsButton").onclick = () => { populateSettings(); settingsDialog.showModal(); };
element<HTMLButtonElement>("dialogRefresh").onclick = () => void discover({ provider: providerSelect.value === "openai-compatible" ? "openai-compatible" : "ollama", baseUrl: baseUrlInput.value });
element<HTMLButtonElement>("applySettings").onclick = (event) => { event.preventDefault(); void applyConfiguration(settingsConfiguration()).then(() => settingsDialog.close()).catch((error) => notify(error instanceof Error ? error.message : String(error))); };
endpointSelect.onchange = () => { if (!endpointSelect.value) return; const selected = JSON.parse(endpointSelect.value) as DesktopEndpoint; providerSelect.value = selected.kind; baseUrlInput.value = selected.baseUrl; void discover({ provider: selected.kind, baseUrl: selected.baseUrl }); };
quickModel.onchange = () => { const next = quickModel.value; if (!next || next === configuration().model) return; void applyConfiguration({ ...configuration(), model: next }).catch((error) => notify(error instanceof Error ? error.message : String(error))); };
document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((button) => button.onclick = () => void applyConfiguration({ ...configuration(), mode: button.dataset.mode as DesktopConfiguration["mode"] }).catch((error) => notify(error instanceof Error ? error.message : String(error))));
element<HTMLFormElement>("chatForm").onsubmit = (event) => { event.preventDefault(); void sendChat(); };
chatInput.oninput = () => { slashIndex = 0; renderSlashMenu(); };
chatInput.onkeydown = (event) => {
  if (slashMenu.hidden || !slashResults.length) return;
  if (event.key === "ArrowDown") { event.preventDefault(); slashIndex = (slashIndex + 1) % slashResults.length; renderSlashMenu(); }
  if (event.key === "ArrowUp") { event.preventDefault(); slashIndex = (slashIndex - 1 + slashResults.length) % slashResults.length; renderSlashMenu(); }
  if ((event.key === "Enter" || event.key === "Tab") && slashResults[slashIndex]) { event.preventDefault(); insertSlashFile(slashResults[slashIndex].path); }
  if (event.key === "Escape") { slashMenu.hidden = true; }
};
stopChat.onclick = () => void window.trussDesktop.stopChat();
cancelChatButton.onclick = () => void window.trussDesktop.stopChat();
element<HTMLFormElement>("terminalForm").onsubmit = (event) => { event.preventDefault(); const input = element<HTMLInputElement>("terminalInput"); const command = input.value.trim(); if (!command) return; input.value = ""; appendTerminal(`\n> ${command}\n`); void window.trussDesktop.runTerminal(command); };
document.querySelectorAll<HTMLButtonElement>("[data-center-view]").forEach((button) => {
  button.onclick = () => setCenterView(button.dataset.centerView === "preview" ? "preview" : "editor");
});
element<HTMLFormElement>("browserForm").onsubmit = (event) => { event.preventDefault(); navigatePreview(browserUrl.value); };
browserBack.onclick = () => { if (browserView.canGoBack()) browserView.goBack(); };
browserForward.onclick = () => { if (browserView.canGoForward()) browserView.goForward(); };
browserReload.onclick = () => { if (browserView.getURL() !== "about:blank") browserView.reload(); };
browserExternal.onclick = () => void window.trussDesktop.openExternal(browserUrl.value).catch((error) => notify(error instanceof Error ? error.message : String(error)));
element<HTMLFormElement>("devServerForm").onsubmit = (event) => {
  event.preventDefault();
  const command = devServerCommand.value.trim();
  if (!command) { notify("Enter a dev-server command."); return; }
  renderDevServer("starting");
  appendTerminal(`\n[dev server] ${command}\n`);
  void window.trussDesktop.startDevServer(command).catch((error) => renderDevServer("failed", error instanceof Error ? error.message : String(error)));
};
stopDevServer.onclick = () => void window.trussDesktop.stopDevServer();
browserView.addEventListener("dom-ready", updateBrowserNavigation);
browserView.addEventListener("did-navigate", updateBrowserNavigation);
browserView.addEventListener("did-navigate-in-page", updateBrowserNavigation);
browserView.addEventListener("did-fail-load", (event) => {
  const detail = event as Event & { readonly errorCode?: number; readonly errorDescription?: string };
  if (detail.errorCode === -3) return;
  notify(detail.errorDescription ? `Preview failed: ${detail.errorDescription}` : "Preview failed to load.");
});
window.addEventListener("keydown", (event) => {
  if (centerView === "editor" && event.ctrlKey && event.key.toLowerCase() === "w" && activeFile) {
    event.preventDefault();
    closeEditorTab(activeFile);
    return;
  }
  if (centerView === "editor" && event.ctrlKey && event.key === "Tab" && openEditorTabs.length > 1) {
    event.preventDefault();
    const current = openEditorTabs.findIndex((tab) => tab.path === activeFile);
    const direction = event.shiftKey ? -1 : 1;
    selectEditorTab(openEditorTabs[(current + direction + openEditorTabs.length) % openEditorTabs.length]);
    return;
  }
  if (centerView === "preview" && event.ctrlKey && event.key.toLowerCase() === "l") {
    event.preventDefault();
    browserUrl.focus();
    browserUrl.select();
  }
  if (centerView === "preview" && event.key === "F5") {
    event.preventDefault();
    if (browserView.getURL() !== "about:blank") browserView.reload();
  }
});

window.trussDesktop.onEvent(handleEvent);
void (async () => {
  desktopState = await window.trussDesktop.initialState();
  populateSettings();
  await discover(desktopState.configuration);
  await Promise.all([loadFiles(), refreshGit(), window.trussDesktop.getPlan().then((plan) => { activePlan = plan; renderPlan(); })]);
  const tracks = sidebarTracks();
  gitPanelHeight = tracks.git;
  applySidebarTracks(tracks.git, tracks.files, tracks.history);
  renderConversations();
  renderChat();
  renderRuntime();
})();
