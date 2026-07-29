import type {
  ChatAttachment,
  ChatMessage,
  ContextBlock,
  RuntimeEvent,
  Session,
} from "@truss-harness/runtime";

export const LOCAL_SERVICE_PROTOCOL_VERSION = 1;
export const LOCAL_SERVICE_PROTOCOL_VERSIONS = [
  LOCAL_SERVICE_PROTOCOL_VERSION,
] as const;

export interface RuntimeServiceCapabilities {
  readonly streaming: true;
  readonly sessions: true;
  readonly cancellation: true;
  readonly approvals: boolean;
  readonly context: true;
  readonly attachments: readonly ("file" | "image")[];
  readonly changedFiles: true;
  readonly providerDiscovery: boolean;
  readonly providerPreflight: boolean;
  readonly agentProfiles: boolean;
  readonly mcpStatus: boolean;
}

export interface RuntimeServiceClient {
  readonly name: string;
  readonly version?: string;
}

export type RuntimeServiceRequest =
  | {
      readonly type: "initialize";
      readonly requestId: string;
      readonly protocolVersions: readonly number[];
      readonly client?: RuntimeServiceClient;
    }
  | {
      readonly type: "run";
      readonly requestId: string;
      readonly prompt: string;
      readonly sessionId?: string;
      readonly context?: readonly ContextBlock[];
      readonly attachments?: readonly ChatAttachment[];
    }
  | {
      readonly type: "create_session";
      readonly requestId: string;
      readonly messages?: readonly ChatMessage[];
    }
  /** Legacy cancellation shape used by VS Code through protocol v0. */
  | { readonly type: "abort"; readonly requestId: string }
  | {
      readonly type: "cancel";
      readonly requestId: string;
      readonly targetRequestId: string;
    }
  | {
      readonly type: "tool_approval";
      readonly requestId: string;
      readonly callId: string;
      readonly approved: boolean;
    }
  | { readonly type: "ping"; readonly requestId: string }
  | { readonly type: "shutdown"; readonly requestId: string };

export type SerializableRuntimeEvent =
  | Exclude<RuntimeEvent, { readonly type: "run_failed" }>
  | {
      readonly type: "run_failed";
      readonly sessionId: string;
      readonly error: string;
    };

export type RuntimeServiceLifecycleState =
  | "started"
  | "completed"
  | "failed"
  | "cancelled";

export interface RuntimeServiceResult {
  readonly protocolVersion?: number;
  readonly server?: {
    readonly name: "truss-cli";
    readonly version: string;
  };
  readonly capabilities?: RuntimeServiceCapabilities;
  readonly sessionId?: string;
  readonly aborted?: boolean;
  readonly cancelled?: boolean;
  readonly targetRequestId?: string;
  readonly pong?: boolean;
  readonly shutdown?: boolean;
  readonly approvalResolved?: boolean;
}

export type RuntimeServiceErrorCode =
  | "invalid_json"
  | "invalid_request"
  | "unsupported_protocol"
  | "unknown_request"
  | "request_conflict"
  | "method_not_found"
  | "internal_error";

export type RuntimeServiceMessage =
  | {
      readonly type: "event";
      readonly requestId: string;
      readonly event: SerializableRuntimeEvent;
    }
  | {
      readonly type: "lifecycle";
      readonly requestId: string;
      readonly state: RuntimeServiceLifecycleState;
      readonly sessionId?: string;
    }
  | {
      readonly type: "response";
      readonly requestId: string;
      readonly result: RuntimeServiceResult;
    }
  | {
      readonly type: "error";
      readonly requestId?: string;
      readonly code: RuntimeServiceErrorCode;
      readonly message: string;
      readonly supportedProtocolVersions?: readonly number[];
    };

export type JsonRpcId = string;

export type RuntimeServiceJsonRpcMessage =
  | {
      readonly jsonrpc: "2.0";
      readonly id: JsonRpcId;
      readonly result: RuntimeServiceResult;
    }
  | {
      readonly jsonrpc: "2.0";
      readonly id: JsonRpcId | null;
      readonly error: {
        readonly code: number;
        readonly message: string;
        readonly data?: {
          readonly code: RuntimeServiceErrorCode;
          readonly supportedProtocolVersions?: readonly number[];
        };
      };
    }
  | {
      readonly jsonrpc: "2.0";
      readonly method: "runtime/event";
      readonly params: {
        readonly requestId: string;
        readonly event: SerializableRuntimeEvent;
      };
    }
  | {
      readonly jsonrpc: "2.0";
      readonly method: "run/lifecycle";
      readonly params: {
        readonly requestId: string;
        readonly state: RuntimeServiceLifecycleState;
        readonly sessionId?: string;
      };
    };

export type RuntimeServiceWireMessage =
  | RuntimeServiceMessage
  | RuntimeServiceJsonRpcMessage;

export type PermissionMode = "ask" | "auto-read" | "auto-all";

export interface RuntimeServiceRuntime {
  createSession(messages?: readonly ChatMessage[]): Promise<Session>;
  getSession(sessionId: string): Promise<Session | undefined>;
  run(
    sessionId: string,
    prompt: string,
    signal?: AbortSignal,
    context?: readonly ContextBlock[],
    attachments?: readonly ChatAttachment[],
  ): Promise<void>;
}

export interface RuntimeServiceEventSource {
  subscribe(listener: (event: RuntimeEvent) => void): () => void;
}
