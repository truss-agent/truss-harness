export type ChatItem = {
  readonly id: string;
  readonly role: "user" | "assistant" | "system";
  readonly content: string;
};

export type AgentMode = "chat" | "plan" | "edit";
export type ApprovalMode = "ask" | "auto-read" | "auto-all";
export type Screen = "home" | "settings" | "session" | "scanner" | "agents";

export type SavedGateway = {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly token: string;
};

export type McpServerStatus = {
  readonly name: string;
  readonly state: "idle" | "disabled" | "connecting" | "connected" | "failed";
  readonly toolCount: number;
  readonly error?: string;
  readonly tools?: readonly {
    readonly name: string;
    readonly description?: string;
    readonly readOnly: boolean;
  }[];
};

export type Workspace = {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: {
    readonly protocolVersions?: readonly number[];
    readonly modes: readonly AgentMode[];
    readonly toolApprovalModes?: readonly ApprovalMode[];
    readonly supportsAgents?: boolean;
    readonly agentActions?: readonly ("start" | "stop" | "approve")[];
    readonly supportsMcpStatus?: boolean;
  };
  readonly mcpServers?: readonly McpServerStatus[];
};

export type AgentProfile = {
  readonly id: string;
  readonly displayName: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly mode: AgentMode;
  readonly approvalPolicy: ApprovalMode;
  readonly internetAccess: boolean;
};

export type AgentRun = {
  readonly id: string;
  readonly agentId: string;
  readonly state:
    | "idle"
    | "queued"
    | "running"
    | "waiting_for_approval"
    | "completed"
    | "failed"
    | "cancelled";
  readonly latestProgress?: string;
  readonly output?: string;
  readonly activeTool?: { readonly callId: string; readonly name: string };
  readonly changedFiles: readonly string[];
  readonly errorCode?: string;
};

export type RemoteEvent = {
  readonly type: string;
  readonly workspaceId?: string;
  readonly sessionId?: string;
  readonly text?: string;
  readonly message?: string;
  readonly callId?: string;
  readonly tool?: string;
  readonly input?: Record<string, unknown>;
  readonly result?: { readonly content: string; readonly isError?: boolean };
  readonly modifiedFiles?: readonly string[];
  readonly run?: AgentRun;
  readonly agentId?: string;
  readonly runId?: string;
  readonly event?: RemoteEvent;
};

export type ToolApproval = {
  readonly callId: string;
  readonly tool: string;
  readonly input: Record<string, unknown>;
};

export type AgentToolApproval = ToolApproval & { readonly runId: string };

export type GatewayCommandResult = {
  readonly type: string;
  readonly sessionId?: string;
  readonly message?: string;
  readonly profiles?: readonly AgentProfile[];
  readonly runs?: readonly AgentRun[];
  readonly run?: AgentRun;
};
