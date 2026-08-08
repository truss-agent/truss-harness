import type { ModelProviderKind } from "@truss-harness/provider-openai-compatible";
import type { ProviderConnectionResult } from "@truss-harness/agent-host";
import type {
  AgentProfile,
  AgentRunSummary,
  CreateAgentProfileInput,
  ProviderAccount,
  UpdateProviderAccountInput,
  UpdateAgentProfileInput,
} from "@truss-harness/runtime";

export type DesktopProvider = ModelProviderKind;
export type DesktopLocalProvider = "ollama" | "openai-compatible";
export type DesktopCredentialStorage = "secure" | "session-only";
export type DesktopMode = "chat" | "plan" | "edit";
export type DesktopPermission = "ask" | "auto-read" | "auto-all";
export const desktopThemeNames = [
  "default",
  "blue",
  "orange",
  "multicolor",
  "custom",
] as const;
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
  /** Opaque provider-account reference; legacy configurations may omit it. */
  readonly credentialAccountId?: string;
  readonly mode: DesktopMode;
  readonly permission: DesktopPermission;
  readonly contextWindow: number;
  /** Provider-reported context window for the selected model, when known. */
  readonly modelContextWindow?: number;
  readonly internetAccess: boolean;
  readonly mcpServers: McpServerConfigurations;
  readonly autocomplete?: {
    readonly enabled: boolean;
    readonly model?: string;
  };
  readonly formatOnSave?: boolean;
}

export interface DesktopModelInfo {
  readonly id: string;
  readonly contextWindow?: number;
  /** USD per one million input tokens, when published by the provider. */
  readonly inputCostPerMillion?: number;
  /** USD per one million output tokens, when published by the provider. */
  readonly outputCostPerMillion?: number;
  readonly supportsTools?: boolean;
  readonly kind?: "chat" | "embedding" | "image" | "audio" | "moderation" | "other";
}

export interface DesktopTokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly estimated?: boolean;
  readonly estimatedCostUsd?: number;
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
  readonly usage?: DesktopTokenUsage;
}

export interface DesktopToolActivity {
  readonly callId: string;
  readonly tool: string;
  readonly status: "progress" | "running" | "completed" | "failed";
  readonly detail?: string;
}

export interface DesktopConversation {
  readonly id: string;
  readonly title: string;
  readonly messages: readonly DesktopMessage[];
  readonly updatedAt: string;
  readonly lastRun?: DesktopRunResult;
  /** The most recent agent run's visible tool trace. */
  readonly toolActivity?: readonly DesktopToolActivity[];
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
  /** Name of the first configured push-capable remote, not its URL. */
  readonly pushRemote?: string;
  readonly error?: string;
}

export interface DesktopGitCommit {
  readonly hash: string;
  readonly shortHash: string;
  readonly subject: string;
  readonly author: string;
  readonly authoredAt: string;
  readonly parents: readonly string[];
  readonly refs: readonly string[];
}

export interface DesktopGitGraph {
  readonly available: boolean;
  readonly commits: readonly DesktopGitCommit[];
  readonly error?: string;
}

export interface DesktopState {
  readonly workspaceRoot: string;
  readonly zoomFactor: number;
  readonly configuration?: DesktopConfiguration;
  readonly updates: {
    readonly checkOnLaunch: boolean;
    readonly autoDownload: boolean;
  };
  readonly theme: DesktopThemePreference;
  readonly conversations: readonly DesktopConversation[];
  readonly activeConversationId?: string;
  readonly mcpStatuses?: readonly McpServerStatus[];
  /** Safe startup/configuration failure text; never contains provider response bodies or keys. */
  readonly runtimeError?: string;
  readonly workspaceUiState?: DesktopWorkspaceUiState;
  /** Workspace-local profiles; provider credentials remain in encrypted host storage. */
  readonly agentProfiles?: readonly AgentProfile[];
  /** Non-secret provider-account metadata; credentials remain host-side. */
  readonly providerAccounts?: readonly ProviderAccount[];
}

export type DesktopEvent =
  | {
      readonly type: "agent";
      readonly conversationId?: string;
      readonly event: {
        readonly type: string;
        readonly sessionId: string;
        readonly text?: string;
        readonly tool?: string;
        readonly callId?: string;
        readonly input?: Record<string, unknown>;
        readonly result?: {
          readonly content?: string;
          readonly isError?: boolean;
        };
        readonly error?: { readonly message?: string };
        readonly plan?: WorkspacePlan;
        readonly modifiedFiles?: readonly string[];
        readonly usage?: Omit<DesktopTokenUsage, "estimated" | "estimatedCostUsd">;
      };
    }
  | {
      readonly type: "file-context-open";
      readonly x: number;
      readonly y: number;
      readonly target: {
        readonly kind: "root" | "directory" | "file";
        readonly path: string;
      };
    }
  | { readonly type: "chat-start"; readonly conversationId: string }
  | {
      readonly type: "chat-end";
      readonly conversationId: string;
      readonly aborted?: boolean;
    }
  | {
      readonly type: "chat-error";
      readonly conversationId: string;
      readonly message: string;
    }
  | {
      readonly type: "approval";
      readonly callId: string;
      readonly tool: string;
      readonly input: Record<string, unknown>;
    }
  | { readonly type: "agents"; readonly snapshot: DesktopAgentsSnapshot }
  | {
      readonly type: "update";
      readonly status:
        | "checking"
        | "available"
        | "not-available"
        | "downloading"
        | "downloaded"
        | "error";
      readonly version?: string;
      readonly percent?: number;
      readonly message?: string;
    }
  | {
      readonly type: "terminal-output";
      readonly commandId: string;
      readonly text: string;
    };

export interface DesktopAgentsSnapshot {
  readonly profiles: readonly AgentProfile[];
  readonly runs: readonly AgentRunSummary[];
}

export interface DesktopBridge {
  initialState(): Promise<DesktopState>;
  chooseWorkspace(): Promise<DesktopState | undefined>;
  saveConversations(
    conversations: readonly DesktopConversation[],
    activeConversationId?: string,
  ): Promise<void>;
  saveWorkspaceUiState(state: DesktopWorkspaceUiState): Promise<void>;
  discoverModels(
    configuration?: Partial<DesktopConfiguration>,
    apiKey?: string,
  ): Promise<{
    readonly endpoints: readonly DesktopEndpoint[];
    readonly models: readonly DesktopModelInfo[];
  }>;
  refreshLocalModel(): Promise<DesktopState>;
  configure(
    configuration: DesktopConfiguration,
    apiKey?: string,
  ): Promise<DesktopState>;
  testProviderConnection(
    configuration: DesktopConfiguration,
    apiKey?: string,
  ): Promise<ProviderConnectionResult>;
  credentialStorage(): Promise<DesktopCredentialStorage>;
  saveProviderAccount(
    input: {
      readonly id?: string;
      readonly providerId: DesktopProvider;
      readonly label: string;
      readonly authMethod: "api-key";
    },
    apiKey: string,
  ): Promise<DesktopState>;
  updateProviderAccount(
    id: string,
    input: UpdateProviderAccountInput,
  ): Promise<DesktopState>;
  deleteProviderAccount(id: string): Promise<DesktopState>;
  testMcpServer(
    name: string,
    configuration: McpStdioServerConfiguration,
  ): Promise<McpServerStatus>;
  clearCredential(provider: DesktopProvider, accountId?: string): Promise<void>;
  configureTheme(theme: DesktopThemePreference): Promise<DesktopState>;
  adjustZoom(direction: -1 | 1): Promise<number>;
  configureUpdates(updates: {
    readonly checkOnLaunch: boolean;
    readonly autoDownload: boolean;
  }): Promise<DesktopState>;
  checkForUpdates(): Promise<void>;
  downloadUpdate(): Promise<void>;
  installUpdate(): Promise<void>;
  sendChat(input: {
    readonly prompt: string;
    readonly conversationId: string;
    readonly history: readonly DesktopMessage[];
    readonly attachments?: readonly import("@truss-harness/runtime").ChatAttachment[];
    readonly activeFilePath?: string;
    readonly attachedPaths?: readonly string[];
    readonly openFilePaths?: readonly string[];
  }): Promise<void>;
  stopChat(): Promise<void>;
  resolveApproval(
    callId: string,
    approved: boolean,
    allowAllForSession?: boolean,
  ): Promise<void>;
  listAgents(): Promise<DesktopAgentsSnapshot>;
  createAgent(input: CreateAgentProfileInput): Promise<DesktopAgentsSnapshot>;
  updateAgent(
    id: string,
    input: UpdateAgentProfileInput,
  ): Promise<DesktopAgentsSnapshot>;
  deleteAgent(id: string): Promise<DesktopAgentsSnapshot>;
  startAgent(id: string, prompt: string): Promise<DesktopAgentsSnapshot>;
  stopAgent(runId: string): Promise<DesktopAgentsSnapshot>;
  stopAllAgents(): Promise<DesktopAgentsSnapshot>;
  resolveAgentApproval(
    runId: string,
    callId: string,
    approved: boolean,
  ): Promise<DesktopAgentsSnapshot>;
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
  gitGraph(): Promise<DesktopGitGraph>;
  gitStage(paths: readonly string[]): Promise<string>;
  gitUnstage(paths: readonly string[]): Promise<string>;
  gitDiscard(paths: readonly string[]): Promise<string>;
  gitGenerateCommitMessage(): Promise<string>;
  gitCommit(message: string): Promise<string>;
  gitPull(): Promise<string>;
  gitPush(): Promise<string>;
  runTerminal(command: string): Promise<string>;
  openExternal(url: string): Promise<void>;
  connectTrussGo(): Promise<{
    readonly workspaceName: string;
    readonly qrDataUrl: string;
  }>;
  disconnectTrussGo(): Promise<void>;
  complete(input: {
    readonly prefix: string;
    readonly suffix: string;
    readonly path: string;
  }): Promise<string>;
  formatFile(path: string, content: string): Promise<string>;
  checkSyntax(
    path: string,
    content: string,
  ): Promise<readonly { readonly line: number; readonly message: string }[]>;
  onEvent(listener: (event: DesktopEvent) => void): () => void;
}
import type { WorkspacePlan } from "@truss-harness/runtime";
import type {
  McpServerConfigurations,
  McpServerStatus,
  McpStdioServerConfiguration,
} from "@truss-harness/mcp";
