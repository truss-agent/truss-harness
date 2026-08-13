import type { ContextBlock } from "../context.js";
import type {
  ChatAttachment,
  ChatMessage,
  JsonObject,
  RuntimeEvent,
  Session,
} from "../contracts.js";
import type { EventListener } from "../events.js";

/** A stable profile identity, independent from a provider session ID. */
export type AgentId = string;
/** A single execution of an agent profile. */
export type AgentRunId = string;

export type ManagedAgentMode = "chat" | "plan" | "edit";
export type AgentApprovalPolicy = "ask" | "auto-read" | "auto-all";
export type AgentRunState =
  | "idle"
  | "queued"
  | "running"
  | "waiting_for_approval"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * A provider-neutral model selection. Hosts resolve this binding through their
 * own provider registry; the runtime never imports a concrete adapter.
 */
export interface AgentProviderBinding {
  readonly providerId: string;
  readonly endpointId?: string;
  readonly endpointUrl?: string;
  readonly modelId: string;
  /** Opaque provider-account or secure-storage reference. Never a credential value. */
  readonly credentialRef?: string;
  readonly options?: JsonObject;
}

export interface AgentProfile {
  readonly id: AgentId;
  readonly displayName: string;
  readonly instructions?: string;
  readonly provider: AgentProviderBinding;
  readonly mode: ManagedAgentMode;
  readonly approvalPolicy: AgentApprovalPolicy;
  readonly internetAccess: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateAgentProfileInput {
  readonly displayName: string;
  readonly instructions?: string;
  readonly provider: AgentProviderBinding;
  readonly mode?: ManagedAgentMode;
  readonly approvalPolicy?: AgentApprovalPolicy;
  readonly internetAccess?: boolean;
}

export interface UpdateAgentProfileInput {
  readonly displayName?: string;
  readonly instructions?: string;
  readonly provider?: AgentProviderBinding;
  readonly mode?: ManagedAgentMode;
  readonly approvalPolicy?: AgentApprovalPolicy;
  readonly internetAccess?: boolean;
}

export interface AgentRunError {
  readonly code:
    | "aborted"
    | "conflict"
    | "invalid_profile"
    | "provider_unavailable"
    | "runtime_error";
  readonly message: string;
}

export interface AgentRunSummary {
  readonly id: AgentRunId;
  readonly agentId: AgentId;
  readonly sessionId?: string;
  readonly state: AgentRunState;
  readonly prompt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly latestProgress?: string;
  /** Bounded assistant text produced during this run, retained for clients and history. */
  readonly output?: string;
  readonly activeTool?: { readonly callId: string; readonly name: string };
  readonly changedFiles: readonly string[];
  readonly error?: AgentRunError;
}

/**
 * A replaceable, credential-free store for completed agent run summaries.
 * Hosts decide where these workspace-local records live; the runtime only
 * keeps their lifecycle and retention policy consistent.
 */
export interface AgentRunHistoryStore {
  load(): Promise<readonly AgentRunSummary[]>;
  save(runs: readonly AgentRunSummary[]): Promise<void>;
}

export interface ManagedAgentEvent {
  readonly agentId: AgentId;
  readonly runId: AgentRunId;
  /** Monotonic within one run. */
  readonly sequence: number;
  readonly occurredAt: string;
  readonly event: RuntimeEvent;
}

/**
 * A secret-safe operational record for host telemetry and diagnostics. Prompt
 * content, model/provider bindings, tool inputs, and credentials are never
 * included so hosts can safely forward these records to their own logger.
 */
export interface AgentLifecycleRecord {
  readonly phase:
    | "queued"
    | "write_lease_acquired"
    | "started"
    | "waiting_for_approval"
    | "approval_resolved"
    | "completed"
    | "failed"
    | "cancelled"
    | "cleanup_completed";
  readonly runId: AgentRunId;
  readonly agentId: AgentId;
  readonly state: AgentRunState;
  readonly occurredAt: string;
  readonly runDurationMs?: number;
  readonly cleanupDurationMs?: number;
  readonly errorCode?: AgentRunError["code"];
}

export type AgentCoordinatorEvent =
  | { readonly type: "run_updated"; readonly run: AgentRunSummary }
  | { readonly type: "runtime"; readonly event: ManagedAgentEvent }
  | { readonly type: "lifecycle"; readonly record: AgentLifecycleRecord };

export interface AgentProfileStore {
  list(): Promise<readonly AgentProfile[]>;
  get(id: AgentId): Promise<AgentProfile | undefined>;
  create(input: CreateAgentProfileInput): Promise<AgentProfile>;
  update(id: AgentId, input: UpdateAgentProfileInput): Promise<AgentProfile>;
  delete(id: AgentId): Promise<boolean>;
}

/** A minimal runtime surface the coordinator needs. */
export interface ManagedAgentRuntime {
  createSession(messages?: readonly ChatMessage[]): Promise<Session>;
  run(
    sessionId: string,
    prompt: string,
    signal?: AbortSignal,
    requestContext?: readonly ContextBlock[],
    attachments?: readonly ChatAttachment[],
  ): Promise<void>;
}

export interface AgentApprovalController {
  resolve(callId: string, approved: boolean): boolean;
  denyAll(): void;
}

export interface CreatedManagedAgentRuntime {
  readonly runtime: ManagedAgentRuntime;
  readonly events: {
    subscribe(listener: EventListener<RuntimeEvent>): () => void;
  };
  readonly approval?: AgentApprovalController;
  dispose(): Promise<void>;
}

/** Implemented by a host that knows provider adapters, tools, credentials, and MCP. */
export interface AgentRuntimeFactory {
  validate(profile: AgentProfile): Promise<void>;
  create(profile: AgentProfile): Promise<CreatedManagedAgentRuntime>;
}

export interface StartAgentRunInput {
  readonly agentId: AgentId;
  readonly prompt: string;
  readonly attachments?: readonly ChatAttachment[];
}
