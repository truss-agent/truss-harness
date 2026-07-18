export type DesktopProvider = "ollama" | "openai-compatible";
export type DesktopMode = "chat" | "plan" | "edit";
export type DesktopPermission = "ask" | "auto-read" | "auto-all";

export interface DesktopConfiguration {
  readonly provider: DesktopProvider;
  readonly baseUrl: string;
  readonly model: string;
  readonly mode: DesktopMode;
  readonly permission: DesktopPermission;
  readonly contextWindow: number;
}

export interface DesktopMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
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
  readonly kind: DesktopProvider;
  readonly baseUrl: string;
}

export interface DesktopFile {
  readonly path: string;
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
  readonly conversations: readonly DesktopConversation[];
  readonly activeConversationId?: string;
}

export type DesktopEvent =
  | { readonly type: "agent"; readonly conversationId?: string; readonly event: { readonly type: string; readonly sessionId: string; readonly text?: string; readonly tool?: string; readonly callId?: string; readonly input?: Record<string, unknown>; readonly result?: { readonly content?: string; readonly isError?: boolean }; readonly error?: { readonly message?: string }; readonly plan?: WorkspacePlan; readonly modifiedFiles?: readonly string[] } }
  | { readonly type: "chat-start"; readonly conversationId: string }
  | { readonly type: "chat-end"; readonly conversationId: string; readonly aborted?: boolean }
  | { readonly type: "chat-error"; readonly conversationId: string; readonly message: string }
  | { readonly type: "approval"; readonly callId: string; readonly tool: string; readonly input: Record<string, unknown> }
  | { readonly type: "terminal-output"; readonly commandId: string; readonly text: string };

export interface DesktopBridge {
  initialState(): Promise<DesktopState>;
  chooseWorkspace(): Promise<DesktopState | undefined>;
  saveConversations(conversations: readonly DesktopConversation[], activeConversationId?: string): Promise<void>;
  discoverModels(configuration?: Partial<DesktopConfiguration>): Promise<{ readonly endpoints: readonly DesktopEndpoint[]; readonly models: readonly string[] }>;
  configure(configuration: DesktopConfiguration): Promise<DesktopState>;
  sendChat(input: { readonly prompt: string; readonly conversationId: string; readonly history: readonly DesktopMessage[]; readonly attachedPaths?: readonly string[] }): Promise<void>;
  stopChat(): Promise<void>;
  resolveApproval(callId: string, approved: boolean): Promise<void>;
  listFiles(): Promise<readonly DesktopFile[]>;
  readFile(path: string): Promise<string>;
  diffFile(path: string): Promise<string>;
  getPlan(): Promise<WorkspacePlan | undefined>;
  gitStatus(): Promise<DesktopGitStatus>;
  gitStage(paths: readonly string[]): Promise<string>;
  gitUnstage(paths: readonly string[]): Promise<string>;
  gitGenerateCommitMessage(): Promise<string>;
  gitCommit(message: string): Promise<string>;
  gitPull(): Promise<string>;
  gitPush(): Promise<string>;
  runTerminal(command: string): Promise<string>;
  onEvent(listener: (event: DesktopEvent) => void): () => void;
}
import type { WorkspacePlan } from "@truss-harness/runtime";
