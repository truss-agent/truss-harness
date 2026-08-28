import type { McpServerConfigurations } from "@truss-harness/mcp";
import type {
  LocalModelEndpoint,
  ModelProviderKind,
} from "@truss-harness/provider-openai-compatible";
import type {
  AgentRunSummary,
  ChatAttachment,
  MasterPromptConfiguration,
  ProviderAccount,
  WorkspacePlan,
} from "@truss-harness/runtime";

export type AgentMode = "chat" | "plan" | "edit";
export type PermissionMode = "ask" | "auto-read" | "auto-all";

export interface ModelConfiguration {
  readonly provider: ModelProviderKind;
  readonly baseUrl: string;
  readonly model: string;
  readonly credentialAccountId?: string;
  readonly mode: AgentMode;
  readonly permission: PermissionMode;
  readonly contextWindow: number;
  readonly internetAccess: boolean;
  readonly masterPrompt?: MasterPromptConfiguration;
  readonly mcpServers: McpServerConfigurations;
}

export interface ServiceEvent {
  readonly type: "event";
  readonly requestId: string;
  readonly event: {
    readonly type: string;
    readonly sessionId: string;
    readonly text?: string;
    readonly tool?: string;
    readonly callId?: string;
    readonly input?: Record<string, unknown>;
    readonly plan?: WorkspacePlan;
  };
}

export interface ServiceLifecycle {
  readonly type: "lifecycle";
  readonly requestId: string;
  readonly state: "started" | "completed" | "failed" | "cancelled";
  readonly sessionId?: string;
}

export interface ServiceResponse {
  readonly type: "response";
  readonly requestId: string;
  readonly result: {
    readonly protocolVersion?: number;
    readonly server?: {
      readonly name: "truss-cli";
      readonly version: string;
      readonly identity?: {
        readonly runtime: {
          readonly packageName: string;
          readonly version: string;
        };
        readonly protocolVersions: readonly number[];
      };
    };
    readonly sessionId?: string;
    readonly aborted?: boolean;
  };
}

export interface ServiceError {
  readonly type: "error";
  readonly requestId?: string;
  readonly message: string;
}

export type ServiceMessage =
  | ServiceEvent
  | ServiceLifecycle
  | ServiceResponse
  | ServiceError;

export interface RunHandle {
  readonly requestId: string;
  readonly result: Promise<ServiceResponse>;
}

export interface ConversationMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly attachments?: readonly ChatAttachment[];
}

export interface StoredConversation {
  readonly id: string;
  readonly title: string;
  readonly messages: readonly ConversationMessage[];
  readonly updatedAt: string;
}

export interface StoredConversationState {
  readonly conversations: readonly StoredConversation[];
  readonly activeId?: string;
}

export type WebviewRequest =
  | { readonly type: "ready" }
  | {
      readonly type: "discover";
      readonly configuration?: ModelConfiguration;
      readonly apiKey?: string;
    }
  | { readonly type: "configure"; readonly configuration: ModelConfiguration }
  | {
      readonly type: "saveProviderAccount";
      readonly provider: ModelProviderKind;
      readonly accountId?: string;
      readonly accountLabel?: string;
      readonly apiKey: string;
      readonly configuration: ModelConfiguration;
    }
  | { readonly type: "removeProviderAccount"; readonly accountId: string }
  | {
      readonly type: "testProviderConnection";
      readonly configuration: ModelConfiguration;
      readonly apiKey?: string;
    }
  | {
      readonly type: "send";
      readonly prompt: string;
      readonly conversationId: string;
      readonly history: readonly ConversationMessage[];
      readonly attachments?: readonly ChatAttachment[];
      readonly attachedPaths?: readonly string[];
    }
  | { readonly type: "stop"; readonly conversationId: string }
  | { readonly type: "newConversation" }
  | { readonly type: "selectConversation"; readonly conversationId: string }
  | { readonly type: "deleteConversation"; readonly conversationId: string }
  | {
      readonly type: "saveConversations";
      readonly state: StoredConversationState;
    }
  | {
      readonly type: "toolApproval";
      readonly conversationId: string;
      readonly requestId: string;
      readonly callId: string;
      readonly approved: boolean;
    }
  | { readonly type: "connectTrussGo" };

export type AgentDashboardRequest =
  | { readonly type: "ready" }
  | {
      readonly type: "start";
      readonly agentId: string;
      readonly prompt: string;
    }
  | { readonly type: "stop"; readonly runId: string }
  | {
      readonly type: "resolveApproval";
      readonly runId: string;
      readonly callId: string;
      readonly approved: boolean;
    }
  | { readonly type: "manageProfiles" };

export interface AgentDashboardProfile {
  readonly id: string;
  readonly displayName: string;
  readonly provider: string;
  readonly model: string;
  readonly mode: AgentMode;
  readonly approvalPolicy: PermissionMode;
}

export interface AgentDashboardRun {
  readonly id: string;
  readonly agentId: string;
  readonly state: AgentRunSummary["state"];
  readonly latestProgress?: string;
  readonly output?: string;
  readonly activeTool?: { readonly callId: string; readonly name: string };
  readonly changedFiles: readonly string[];
  readonly error?: string;
}

export interface DiscoveredModel {
  readonly id: string;
  readonly contextWindow?: number;
  readonly inputCostPerMillion?: number;
  readonly outputCostPerMillion?: number;
}

export interface HostState {
  readonly configuration: ModelConfiguration;
  readonly endpoints: readonly LocalModelEndpoint[];
  readonly models: readonly DiscoveredModel[];
  readonly providerAccounts: readonly (ProviderAccount & {
    readonly hasCredential: boolean;
  })[];
  readonly cloudProviders: readonly {
    readonly id: string;
    readonly label: string;
    readonly baseUrl: string;
  }[];
}
