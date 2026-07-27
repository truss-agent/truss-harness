import type { ChatAttachment, JsonObject, RuntimeEvent, ToolResult } from "./contracts.js";
import type { WorkspacePlan } from "./plans.js";

/** The first version of the provider-neutral protocol used by remote Truss clients. */
export const REMOTE_SESSION_PROTOCOL_VERSION = 1 as const;
/** The protocol revision that adds workspace-scoped managed-agent controls. */
export const REMOTE_AGENT_PROTOCOL_VERSION = 2 as const;
/** Protocol revisions a host may negotiate with a remote client. */
export const REMOTE_PROTOCOL_VERSIONS = [
  REMOTE_SESSION_PROTOCOL_VERSION,
  REMOTE_AGENT_PROTOCOL_VERSION,
] as const;
export type RemoteProtocolVersion = (typeof REMOTE_PROTOCOL_VERSIONS)[number];

/** Host-controlled policy for handling remote agent tool requests. */
export type RemoteToolApprovalMode = "ask" | "auto-read" | "auto-all";
/** Actions a host has explicitly delegated to an authenticated remote client. */
export type RemoteAgentAction = "start" | "stop" | "approve";

/** An opaque workspace identifier. Remote clients must never supply a host filesystem path. */
export interface RemoteWorkspace {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: RemoteHostCapabilities;
}

/** Features a host is willing to expose to a connected client. */
export interface RemoteHostCapabilities {
  /** Versions the host can negotiate. Clients should select the highest shared version. */
  readonly protocolVersions: readonly RemoteProtocolVersion[];
  readonly modes: readonly ("chat" | "plan" | "edit")[];
  /** Approval policies the host allows the connected client to select. */
  readonly toolApprovalModes: readonly RemoteToolApprovalMode[];
  readonly supportsAttachments: boolean;
  readonly supportsDiffs: boolean;
  readonly supportsToolApproval: boolean;
  /** Whether this workspace exposes the optional managed-agent command family. */
  readonly supportsAgents: boolean;
  /** Managed-agent actions authorized by this host for the paired client. */
  readonly agentActions: readonly RemoteAgentAction[];
}

/** Metadata used by a transport during pairing and connection setup. Authentication remains transport-owned. */
export interface RemoteClientDescriptor {
  readonly id: string;
  readonly displayName: string;
  readonly platform: "mobile" | "desktop" | "web" | "unknown";
}

interface RemoteCommandEnvelope {
  readonly version: RemoteProtocolVersion;
  readonly requestId: string;
}

interface RemoteAgentCommandEnvelope {
  readonly version: typeof REMOTE_AGENT_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly workspaceId: string;
}

/** A credential-safe profile descriptor for a trusted paired client. */
export interface RemoteAgentProfile {
  readonly id: string;
  readonly displayName: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly mode: "chat" | "plan" | "edit";
  readonly approvalPolicy: RemoteToolApprovalMode;
  readonly internetAccess: boolean;
}

/** A credential-safe managed-agent state snapshot. Prompt text is deliberately excluded. */
export interface RemoteAgentRunSummary {
  readonly id: string;
  readonly agentId: string;
  readonly sessionId?: string;
  readonly state: "idle" | "queued" | "running" | "waiting_for_approval" | "completed" | "failed" | "cancelled";
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly latestProgress?: string;
  /** Bounded assistant text produced by the managed agent. */
  readonly output?: string;
  readonly activeTool?: { readonly callId: string; readonly name: string };
  readonly changedFiles: readonly string[];
  readonly errorCode?: string;
}

/** Commands a remote client may request. The host authorizes every command against its own policy. */
export type RemoteClientCommand =
  | (RemoteCommandEnvelope & { readonly type: "create_session"; readonly workspaceId: string; readonly mode: "chat" | "plan" | "edit"; readonly toolApprovalMode?: RemoteToolApprovalMode })
  | (RemoteCommandEnvelope & { readonly type: "change_session_mode"; readonly sessionId: string; readonly mode: "chat" | "plan" | "edit"; readonly toolApprovalMode?: RemoteToolApprovalMode })
  | (RemoteCommandEnvelope & { readonly type: "send_message"; readonly sessionId: string; readonly prompt: string; readonly attachments?: readonly ChatAttachment[] })
  | (RemoteCommandEnvelope & { readonly type: "approve_tool"; readonly sessionId: string; readonly callId: string; readonly approved: boolean })
  | (RemoteCommandEnvelope & { readonly type: "interrupt"; readonly sessionId: string })
  | (RemoteAgentCommandEnvelope & { readonly type: "list_agents" })
  | (RemoteAgentCommandEnvelope & { readonly type: "start_agent"; readonly agentId: string; readonly prompt: string; readonly attachments?: readonly ChatAttachment[] })
  | (RemoteAgentCommandEnvelope & { readonly type: "stop_agent"; readonly runId: string })
  | (RemoteAgentCommandEnvelope & { readonly type: "resolve_agent_approval"; readonly runId: string; readonly callId: string; readonly approved: boolean });

export type RemoteCommandResult =
  | { readonly requestId: string; readonly type: "session_created"; readonly sessionId: string }
  | { readonly requestId: string; readonly type: "accepted" }
  | { readonly requestId: string; readonly type: "agents_listed"; readonly profiles: readonly RemoteAgentProfile[]; readonly runs: readonly RemoteAgentRunSummary[] }
  | { readonly requestId: string; readonly type: "agent_run"; readonly run: RemoteAgentRunSummary }
  | { readonly requestId: string; readonly type: "rejected"; readonly code: "invalid_command" | "not_authorized" | "not_found" | "conflict"; readonly message: string };

/** JSON-safe, sequenced events for clients that are not running in the host process. */
export type RemoteSessionEvent =
  | { readonly version: typeof REMOTE_SESSION_PROTOCOL_VERSION; readonly sequence: number; readonly type: "run_started"; readonly sessionId: string }
  | { readonly version: typeof REMOTE_SESSION_PROTOCOL_VERSION; readonly sequence: number; readonly type: "progress_delta"; readonly sessionId: string; readonly text: string }
  | { readonly version: typeof REMOTE_SESSION_PROTOCOL_VERSION; readonly sequence: number; readonly type: "text_delta"; readonly sessionId: string; readonly text: string }
  | { readonly version: typeof REMOTE_SESSION_PROTOCOL_VERSION; readonly sequence: number; readonly type: "tool_call_requested"; readonly sessionId: string; readonly callId: string; readonly tool: string; readonly input: JsonObject }
  | { readonly version: typeof REMOTE_SESSION_PROTOCOL_VERSION; readonly sequence: number; readonly type: "tool_completed"; readonly sessionId: string; readonly callId: string; readonly tool: string; readonly result: ToolResult }
  | { readonly version: typeof REMOTE_SESSION_PROTOCOL_VERSION; readonly sequence: number; readonly type: "plan_updated"; readonly sessionId: string; readonly plan: WorkspacePlan }
  | { readonly version: typeof REMOTE_SESSION_PROTOCOL_VERSION; readonly sequence: number; readonly type: "run_completed"; readonly sessionId: string; readonly modifiedFiles: readonly string[] }
  | { readonly version: typeof REMOTE_SESSION_PROTOCOL_VERSION; readonly sequence: number; readonly type: "run_failed"; readonly sessionId: string; readonly message: string };

/** Agent events are v2 envelopes; nested runtime events remain compatible v1 payloads. */
export type RemoteAgentEvent =
  | { readonly version: typeof REMOTE_AGENT_PROTOCOL_VERSION; readonly sequence: number; readonly type: "agent_run_updated"; readonly workspaceId: string; readonly run: RemoteAgentRunSummary }
  | { readonly version: typeof REMOTE_AGENT_PROTOCOL_VERSION; readonly sequence: number; readonly type: "agent_runtime"; readonly workspaceId: string; readonly agentId: string; readonly runId: string; readonly runSequence: number; readonly occurredAt: string; readonly event: RemoteSessionEvent };

export type RemoteGatewayEvent = RemoteSessionEvent | RemoteAgentEvent;

/**
 * Maps in-process runtime events to the versioned wire form. It intentionally
 * replaces Error instances with plain messages before a transport serializes them.
 */
export function toRemoteSessionEvent(event: RuntimeEvent, sequence: number): RemoteSessionEvent {
  const envelope = { version: REMOTE_SESSION_PROTOCOL_VERSION, sequence, sessionId: event.sessionId } as const;
  switch (event.type) {
    case "run_started": return { ...envelope, type: event.type };
    case "progress_delta": return { ...envelope, type: event.type, text: event.text };
    case "text_delta": return { ...envelope, type: event.type, text: event.text };
    case "tool_call_requested": return { ...envelope, type: event.type, callId: event.callId, tool: event.tool, input: event.input };
    case "tool_completed": return { ...envelope, type: event.type, callId: event.callId, tool: event.tool, result: event.result };
    case "plan_updated": return { ...envelope, type: event.type, plan: event.plan };
    case "run_completed": return { ...envelope, type: event.type, modifiedFiles: event.modifiedFiles };
    case "run_failed": return { ...envelope, type: event.type, message: event.error.message };
  }
}

/** A transport-neutral connection. Implementations may use local IPC, WebSocket, or SSE. */
export interface RemoteSessionTransport {
  readonly protocolVersion: RemoteProtocolVersion;
  readonly client: RemoteClientDescriptor;
  readonly workspaces: readonly RemoteWorkspace[];
  execute(command: RemoteClientCommand): Promise<RemoteCommandResult>;
  events(signal?: AbortSignal): AsyncIterable<RemoteGatewayEvent>;
  close(): Promise<void>;
}
