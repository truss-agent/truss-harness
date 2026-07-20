import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge, DesktopConfiguration, DesktopConversation, DesktopEvent, DesktopMessage } from "./shared.js";

const bridge: DesktopBridge = {
  initialState: () => ipcRenderer.invoke("truss:initial-state"),
  chooseWorkspace: () => ipcRenderer.invoke("truss:choose-workspace"),
  saveConversations: (conversations: readonly DesktopConversation[], activeConversationId?: string) => ipcRenderer.invoke("truss:save-conversations", conversations, activeConversationId),
  discoverModels: (configuration?: Partial<DesktopConfiguration>) => ipcRenderer.invoke("truss:discover-models", configuration),
  refreshLocalModel: () => ipcRenderer.invoke("truss:refresh-local-model"),
  configure: (configuration: DesktopConfiguration) => ipcRenderer.invoke("truss:configure", configuration),
  configureUpdates: (updates: { readonly checkOnLaunch: boolean; readonly autoDownload: boolean }) => ipcRenderer.invoke("truss:configure-updates", updates),
  checkForUpdates: () => ipcRenderer.invoke("truss:check-for-updates"),
  downloadUpdate: () => ipcRenderer.invoke("truss:download-update"),
  installUpdate: () => ipcRenderer.invoke("truss:install-update"),
  sendChat: (input: { readonly prompt: string; readonly conversationId: string; readonly history: readonly DesktopMessage[]; readonly activeFilePath?: string; readonly attachedPaths?: readonly string[]; readonly openFilePaths?: readonly string[] }) => ipcRenderer.invoke("truss:send-chat", input),
  stopChat: () => ipcRenderer.invoke("truss:stop-chat"),
  resolveApproval: (callId: string, approved: boolean) => ipcRenderer.invoke("truss:resolve-approval", callId, approved),
  listFiles: () => ipcRenderer.invoke("truss:list-files"),
  readFile: (path: string) => ipcRenderer.invoke("truss:read-file", path),
  writeFile: (path: string, content: string) => ipcRenderer.invoke("truss:write-file", path, content),
  diffFile: (path: string) => ipcRenderer.invoke("truss:diff-file", path),
  getPlan: () => ipcRenderer.invoke("truss:get-plan"),
  gitStatus: () => ipcRenderer.invoke("truss:git-status"),
  gitStage: (paths: readonly string[]) => ipcRenderer.invoke("truss:git-stage", paths),
  gitUnstage: (paths: readonly string[]) => ipcRenderer.invoke("truss:git-unstage", paths),
  gitDiscard: (paths: readonly string[]) => ipcRenderer.invoke("truss:git-discard", paths),
  gitGenerateCommitMessage: () => ipcRenderer.invoke("truss:git-generate-commit-message"),
  gitCommit: (message: string) => ipcRenderer.invoke("truss:git-commit", message),
  gitPull: () => ipcRenderer.invoke("truss:git-pull"),
  gitPush: () => ipcRenderer.invoke("truss:git-push"),
  runTerminal: (command: string) => ipcRenderer.invoke("truss:run-terminal", command),
  startDevServer: (command: string) => ipcRenderer.invoke("truss:start-dev-server", command),
  stopDevServer: () => ipcRenderer.invoke("truss:stop-dev-server"),
  openExternal: (url: string) => ipcRenderer.invoke("truss:open-external", url),
  onEvent: (listener: (event: DesktopEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, event: DesktopEvent): void => listener(event);
    ipcRenderer.on("truss:event", handler);
    return () => ipcRenderer.removeListener("truss:event", handler);
  }
};

contextBridge.exposeInMainWorld("trussDesktop", bridge);
