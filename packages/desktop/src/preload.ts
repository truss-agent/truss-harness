import { contextBridge, ipcRenderer } from "electron";
import type {
  DesktopBridge,
  DesktopConfiguration,
  DesktopConversation,
  DesktopEvent,
  DesktopMessage,
  DesktopWorkspaceUiState,
} from "./shared.js";

const bridge: DesktopBridge = {
  appVersion: () => ipcRenderer.invoke("truss:app-version"),
  initialState: () => ipcRenderer.invoke("truss:initial-state"),
  chooseWorkspace: () => ipcRenderer.invoke("truss:choose-workspace"),
  saveConversations: (
    conversations: readonly DesktopConversation[],
    activeConversationId?: string,
  ) =>
    ipcRenderer.invoke(
      "truss:save-conversations",
      conversations,
      activeConversationId,
    ),
  saveWorkspaceUiState: (state: DesktopWorkspaceUiState) =>
    ipcRenderer.invoke("truss:save-workspace-ui-state", state),
  discoverModels: (
    configuration?: Partial<DesktopConfiguration>,
    apiKey?: string,
  ) => ipcRenderer.invoke("truss:discover-models", configuration, apiKey),
  refreshLocalModel: () => ipcRenderer.invoke("truss:refresh-local-model"),
  configure: (configuration: DesktopConfiguration, apiKey?: string) =>
    ipcRenderer.invoke("truss:configure", configuration, apiKey),
  testProviderConnection: (
    configuration: DesktopConfiguration,
    apiKey?: string,
  ) =>
    ipcRenderer.invoke("truss:test-provider-connection", configuration, apiKey),
  credentialStorage: () => ipcRenderer.invoke("truss:credential-storage"),
  saveProviderAccount: (input, apiKey) =>
    ipcRenderer.invoke("truss:save-provider-account", input, apiKey),
  updateProviderAccount: (id, input) =>
    ipcRenderer.invoke("truss:update-provider-account", id, input),
  deleteProviderAccount: (id) =>
    ipcRenderer.invoke("truss:delete-provider-account", id),
  testMcpServer: (name, configuration) =>
    ipcRenderer.invoke("truss:test-mcp-server", name, configuration),
  clearCredential: (provider, accountId) =>
    ipcRenderer.invoke("truss:clear-credential", provider, accountId),
  configureTheme: (theme) => ipcRenderer.invoke("truss:configure-theme", theme),
  adjustZoom: (direction) => ipcRenderer.invoke("truss:adjust-zoom", direction),
  configureUpdates: (updates: {
    readonly checkOnLaunch: boolean;
    readonly autoDownload: boolean;
  }) => ipcRenderer.invoke("truss:configure-updates", updates),
  checkForUpdates: () => ipcRenderer.invoke("truss:check-for-updates"),
  downloadUpdate: () => ipcRenderer.invoke("truss:download-update"),
  installUpdate: () => ipcRenderer.invoke("truss:install-update"),
  sendChat: (input: {
    readonly prompt: string;
    readonly conversationId: string;
    readonly history: readonly DesktopMessage[];
    readonly attachments?: readonly import("@truss-harness/runtime").ChatAttachment[];
    readonly activeFilePath?: string;
    readonly attachedPaths?: readonly string[];
    readonly openFilePaths?: readonly string[];
  }) => ipcRenderer.invoke("truss:send-chat", input),
  stopChat: () => ipcRenderer.invoke("truss:stop-chat"),
  resolveApproval: (
    callId: string,
    approved: boolean,
    allowAllForSession?: boolean,
  ) =>
    ipcRenderer.invoke(
      "truss:resolve-approval",
      callId,
      approved,
      allowAllForSession,
    ),
  listAgents: () => ipcRenderer.invoke("truss:list-agents"),
  createAgent: (input) => ipcRenderer.invoke("truss:create-agent", input),
  updateAgent: (id, input) =>
    ipcRenderer.invoke("truss:update-agent", id, input),
  deleteAgent: (id) => ipcRenderer.invoke("truss:delete-agent", id),
  startAgent: (id, prompt) =>
    ipcRenderer.invoke("truss:start-agent", id, prompt),
  stopAgent: (runId) => ipcRenderer.invoke("truss:stop-agent", runId),
  stopAllAgents: () => ipcRenderer.invoke("truss:stop-all-agents"),
  resolveAgentApproval: (runId, callId, approved) =>
    ipcRenderer.invoke("truss:resolve-agent-approval", runId, callId, approved),
  listFiles: () => ipcRenderer.invoke("truss:list-files"),
  listDirectory: (path: string) =>
    ipcRenderer.invoke("truss:list-directory", path),
  readFile: (path: string) => ipcRenderer.invoke("truss:read-file", path),
  writeFile: (path: string, content: string) =>
    ipcRenderer.invoke("truss:write-file", path, content),
  createWorkspaceFile: (path: string) =>
    ipcRenderer.invoke("truss:create-workspace-file", path),
  createWorkspaceFolder: (path: string) =>
    ipcRenderer.invoke("truss:create-workspace-folder", path),
  renameWorkspaceEntry: (path: string, nextPath: string) =>
    ipcRenderer.invoke("truss:rename-workspace-entry", path, nextPath),
  copyWorkspaceEntry: (path: string, destinationPath: string) =>
    ipcRenderer.invoke("truss:copy-workspace-entry", path, destinationPath),
  deleteWorkspaceEntry: (path: string) =>
    ipcRenderer.invoke("truss:delete-workspace-entry", path),
  revealWorkspaceEntry: (path: string) =>
    ipcRenderer.invoke("truss:reveal-workspace-entry", path),
  diffFile: (path: string) => ipcRenderer.invoke("truss:diff-file", path),
  getPlan: () => ipcRenderer.invoke("truss:get-plan"),
  gitStatus: () => ipcRenderer.invoke("truss:git-status"),
  gitGraph: () => ipcRenderer.invoke("truss:git-graph"),
  gitStage: (paths: readonly string[]) =>
    ipcRenderer.invoke("truss:git-stage", paths),
  gitUnstage: (paths: readonly string[]) =>
    ipcRenderer.invoke("truss:git-unstage", paths),
  gitDiscard: (paths: readonly string[]) =>
    ipcRenderer.invoke("truss:git-discard", paths),
  gitGenerateCommitMessage: () =>
    ipcRenderer.invoke("truss:git-generate-commit-message"),
  gitCommit: (message: string) =>
    ipcRenderer.invoke("truss:git-commit", message),
  gitPull: () => ipcRenderer.invoke("truss:git-pull"),
  gitPush: () => ipcRenderer.invoke("truss:git-push"),
  runTerminal: (command: string) =>
    ipcRenderer.invoke("truss:run-terminal", command),
  stopTerminal: () => ipcRenderer.invoke("truss:stop-terminal"),
  openExternal: (url: string) => ipcRenderer.invoke("truss:open-external", url),
  connectTrussGo: () => ipcRenderer.invoke("truss:connect-truss-go"),
  disconnectTrussGo: () => ipcRenderer.invoke("truss:disconnect-truss-go"),
  complete: (input) => ipcRenderer.invoke("truss:complete", input),
  formatFile: (path, content) =>
    ipcRenderer.invoke("truss:format-file", path, content),
  checkSyntax: (path, content) =>
    ipcRenderer.invoke("truss:check-syntax", path, content),
  onEvent: (listener: (event: DesktopEvent) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      event: DesktopEvent,
    ): void => listener(event);
    ipcRenderer.on("truss:event", handler);
    return () => ipcRenderer.removeListener("truss:event", handler);
  },
};

contextBridge.exposeInMainWorld("trussDesktop", bridge);
