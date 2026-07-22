import type { ModelProviderKind } from "@truss-harness/provider-openai-compatible";

export type DesktopProvider = ModelProviderKind;
export type DesktopLocalProvider = "ollama" | "openai-compatible";
export type DesktopMode = "chat" | "plan" | "edit";
export type DesktopPermission = "ask" | "auto-read" | "auto-all";
export const desktopThemeNames = ["default", "blue", "orange", "multicolor", "custom"] as const;
export type DesktopThemeName = (typeof desktopThemeNames)[number];

/** Palette tokens used by a custom Desktop theme. Omitted values retain the default token. */
export interface DesktopThemePalette {
  readonly background?: string;
  readonly surface?: string;
  readonly panel?: string;
  readonly border?: string;
  readonly text?: string;
  readonly muted?: string;
  readonly accent?: string;
  readonly accentText?: string;
  readonly warning?: string;
  readonly error?: string;
}

export interface DesktopThemePreference {
  readonly name: DesktopThemeName;
  readonly custom?: DesktopThemePalette;
}

export interface DesktopConfiguration {
  readonly provider: DesktopProvider;
  readonly baseUrl: string;
  readonly model: string;
  readonly mode: DesktopMode;
  readonly permission: DesktopPermission;
  readonly contextWindow: number;
  readonly internetAccess: boolean;
  readonly mcpServers: McpServerConfigurations;
}

export interface DesktopMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly attachments?: readonly import("@truss-harness/runtime").ChatAttachment[];
}

export interface DesktopRunResult {
  readonly status: "running" | "completed" | "failed";
  readonly modifiedFiles: readonly string[];
  readonly completedAt?: string;
}

export interface DesktopConversation {
  readonly id: string;
  readonly title: string;
  readonly messages: readonly DesktopMessage[];
  readonly updatedAt: string;
  readonly lastRun?: DesktopRunResult;
}

export interface DesktopEndpoint {
  readonly id: string;
  readonly label: string;
  readonly kind: DesktopLocalProvider;
  readonly baseUrl: string;
}

export interface DesktopFile {
  readonly path: string;
  readonly type: "file" | "directory";
}

export interface DesktopWorkspaceUiState {
  readonly expandedDirectories: readonly string[];
  readonly openEditors: readonly {
    readonly path: string;
    readonly mode: "file" | "diff";
    readonly scrollTop: number;
  }[];
  readonly activeFile?: string;
  readonly fileTreeScrollTop: number;
}

export interface DesktopGitFile {
  readonly path: string;
  readonly indexStatus: string;
  readonly workTreeStatus: string;
}

export interface DesktopGitStatus {
  readonly available: boolean;
  readonly branch?: string;
  readonly ahead: number;
  readonly behind: number;
  readonly files: readonly DesktopGitFile[];
  readonly error?: string;
}

export interface DesktopState {
  readonly workspaceRoot: string;
  readonly configuration?: DesktopConfiguration;
  readonly updates: { readonly checkOnLaunch: boolean; readonly autoDownload: boolean };
  readonly theme: DesktopThemePreference;
  readonly conversations: readonly DesktopConversation[];
  readonly activeConversationId?: string;
  readonly mcpStatuses?: readonly McpServerStatus[];
  readonly workspaceUiState?: DesktopWorkspaceUiState;
}

export type DesktopEvent =
  | { readonly type: "agent"; readonly conversationId?: string; readonly event: { readonly type: string; readonly sessionId: string; readonly text?: string; readonly tool?: string; readonly callId?: string; readonly input?: Record<string, unknown>; readonly result?: { readonly content?: string; readonly isError?: boolean }; readonly error?: { readonly message?: string }; readonly plan?: WorkspacePlan; readonly modifiedFiles?: readonly string[] } }
  | { readonly type: "chat-start"; readonly conversationId: string }
  | { readonly type: "chat-end"; readonly conversationId: string; readonly aborted?: boolean }
  | { readonly type: "chat-error"; readonly conversationId: string; readonly message: string }
  | { readonly type: "approval"; readonly callId: string; readonly tool: string; readonly input: Record<string, unknown> }
  | { readonly type: "dev-server"; readonly status: "starting" | "running" | "stopped" | "failed"; readonly command?: string; readonly url?: string; readonly message?: string }
  | { readonly type: "update"; readonly status: "checking" | "available" | "not-available" | "downloading" | "downloaded" | "error"; readonly version?: string; readonly percent?: number; readonly message?: string }
  | { readonly type: "terminal-output"; readonly commandId: string; readonly text: string };

export interface DesktopBridge {
  initialState(): Promise<DesktopState>;
  chooseWorkspace(): Promise<DesktopState | undefined>;
  saveConversations(conversations: readonly DesktopConversation[], activeConversationId?: string): Promise<void>;
  saveWorkspaceUiState(state: DesktopWorkspaceUiState): Promise<void>;
  discoverModels(configuration?: Partial<DesktopConfiguration>): Promise<{ readonly endpoints: readonly DesktopEndpoint[]; readonly models: readonly string[] }>;
  refreshLocalModel(): Promise<DesktopState>;
  configure(configuration: DesktopConfiguration, apiKey?: string): Promise<DesktopState>;
  clearCredential(provider: DesktopProvider): Promise<void>;
  configureTheme(theme: DesktopThemePreference): Promise<DesktopState>;
  configureUpdates(updates: { readonly checkOnLaunch: boolean; readonly autoDownload: boolean }): Promise<DesktopState>;
  checkForUpdates(): Promise<void>;
  downloadUpdate(): Promise<void>;
  installUpdate(): Promise<void>;
  sendChat(input: { readonly prompt: string; readonly conversationId: string; readonly history: readonly DesktopMessage[]; readonly attachments?: readonly import("@truss-harness/runtime").ChatAttachment[]; readonly activeFilePath?: string; readonly attachedPaths?: readonly string[]; readonly openFilePaths?: readonly string[] }): Promise<void>;
  stopChat(): Promise<void>;
  resolveApproval(callId: string, approved: boolean): Promise<void>;
  listFiles(): Promise<readonly DesktopFile[]>;
  listDirectory(path: string): Promise<readonly DesktopFile[]>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  createWorkspaceFile(path: string): Promise<void>;
  createWorkspaceFolder(path: string): Promise<void>;
  renameWorkspaceEntry(path: string, nextPath: string): Promise<void>;
  copyWorkspaceEntry(path: string, destinationPath: string): Promise<void>;
  deleteWorkspaceEntry(path: string): Promise<void>;
  revealWorkspaceEntry(path: string): Promise<void>;
  diffFile(path: string): Promise<string>;
  getPlan(): Promise<WorkspacePlan | undefined>;
  gitStatus(): Promise<DesktopGitStatus>;
  gitStage(paths: readonly string[]): Promise<string>;
  gitUnstage(paths: readonly string[]): Promise<string>;
  gitDiscard(paths: readonly string[]): Promise<string>;
  gitGenerateCommitMessage(): Promise<string>;
  gitCommit(message: string): Promise<string>;
  gitPull(): Promise<string>;
  gitPush(): Promise<string>;
  runTerminal(command: string): Promise<string>;
  startDevServer(command: string): Promise<string>;
  stopDevServer(): Promise<void>;
  openExternal(url: string): Promise<void>;
  connectTrussGo(): Promise<{ readonly workspaceName: string; readonly qrDataUrl: string }>;
  disconnectTrussGo(): Promise<void>;
  onEvent(listener: (event: DesktopEvent) => void): () => void;
}
import type { WorkspacePlan } from "@truss-harness/runtime";
import type { McpServerConfigurations, McpServerStatus } from "@truss-harness/mcp";
