import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline";
import type {
  ChatAttachment,
  ContextBlock,
  RuntimeEvent,
  Session,
  ToolApproval,
  ToolCall,
} from "@truss-harness/runtime";
import {
  LOCAL_SERVICE_PROTOCOL_VERSIONS,
  type PermissionMode,
  type RuntimeServiceCapabilities,
  type RuntimeServiceErrorCode,
  type RuntimeServiceEventSource,
  type RuntimeServiceHost,
  type RuntimeServiceJsonRpcMessage,
  type RuntimeServiceMessage,
  type RuntimeServiceResult,
  type RuntimeServiceRuntime,
  type RuntimeServiceWireMessage,
  type SerializableRuntimeEvent,
} from "./protocol-contracts.js";
import {
  protocolObject,
  requestError,
  sanitizeAttachments,
  sanitizeContext,
  sanitizeMessages,
  sanitizePrompt,
  validRequestId,
} from "./protocol-validation.js";

export * from "./protocol-contracts.js";

export interface RuntimeServiceOptions {
  readonly runtime: RuntimeServiceRuntime;
  readonly events: RuntimeServiceEventSource;
  readonly write: (message: RuntimeServiceWireMessage) => void;
  readonly approval?: ProtocolToolApproval;
  readonly host?: RuntimeServiceHost;
  readonly serverVersion?: string;
  readonly capabilities?: Partial<RuntimeServiceCapabilities>;
  /** Kept during migration so released VS Code clients can still connect. */
  readonly allowLegacyRequests?: boolean;
}

const readOnlyTools = new Set([
  "read_file",
  "list_directory",
  "search_files",
  "grep",
]);
interface PendingApproval {
  readonly sessionId: string;
  readonly resolve: (approved: boolean) => void;
}

type ApprovalListener = (call: ToolCall, session: Session) => void;

/** Bridges runtime approval requests to a client using the JSONL service protocol. */
export class ProtocolToolApproval implements ToolApproval {
  private readonly pending = new Map<string, PendingApproval>();
  private readonly listeners = new Set<ApprovalListener>();

  constructor(private readonly mode: PermissionMode = "ask") {}

  approve(call: ToolCall, session: Session): Promise<boolean> {
    if (this.mode === "auto-all") return Promise.resolve(true);
    if (this.mode === "auto-read" && readOnlyTools.has(call.name))
      return Promise.resolve(true);
    const result = new Promise<boolean>((resolve) =>
      this.pending.set(call.id, { sessionId: session.id, resolve }),
    );
    for (const listener of this.listeners) listener(call, session);
    return result;
  }

  subscribe(listener: ApprovalListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  resolve(callId: string, approved: boolean): boolean {
    const pending = this.pending.get(callId);
    if (!pending) return false;
    this.pending.delete(callId);
    pending.resolve(approved);
    return true;
  }

  denySession(sessionId: string): void {
    for (const [callId, pending] of this.pending) {
      if (pending.sessionId !== sessionId) continue;
      this.pending.delete(callId);
      pending.resolve(false);
    }
  }

  denyAll(): void {
    for (const pending of this.pending.values()) pending.resolve(false);
    this.pending.clear();
  }
}

function serviceCapabilities(
  options: RuntimeServiceOptions,
): RuntimeServiceCapabilities {
  return {
    streaming: true,
    sessions: true,
    cancellation: true,
    approvals: Boolean(options.approval),
    context: true,
    attachments: ["file", "image"],
    changedFiles: true,
    providerDiscovery: false,
    providerPreflight: Boolean(options.host?.testProviderConnection),
    configurationProfiles: Boolean(options.host?.listProfiles),
    agentProfiles: false,
    mcpStatus: Boolean(options.host?.listMcpServers),
    ...options.capabilities,
  };
}

function serializeEvent(event: RuntimeEvent): SerializableRuntimeEvent {
  return event.type === "run_failed"
    ? {
        type: "run_failed",
        sessionId: event.sessionId,
        error: event.error.message,
      }
    : event;
}

/**
 * Stateful, transport-independent local service. Clients exchange one JSON
 * object per line; the class owns request routing and deterministic cleanup.
 */
export class RuntimeService {
  private readonly controllers = new Map<string, AbortController>();
  private readonly requestSessions = new Map<string, string>();
  private readonly activeRequestBySession = new Map<string, string>();
  private readonly activeRequestIds = new Set<string>();
  private readonly activeRuns = new Set<Promise<void>>();
  private readonly unsubscribe: () => void;
  private readonly unsubscribeApproval?: () => void;
  private readonly capabilities: RuntimeServiceCapabilities;
  private initialized = false;
  private closed = false;
  private wireMode: "legacy" | "jsonrpc" | undefined;

  constructor(private readonly options: RuntimeServiceOptions) {
    this.capabilities = serviceCapabilities(options);
    this.unsubscribe = options.events.subscribe((event) => {
      const requestId = this.activeRequestBySession.get(event.sessionId);
      if (!requestId || this.closed) return;
      this.send({
        type: "event",
        requestId,
        event: serializeEvent(event),
      });
    });
    this.unsubscribeApproval = options.approval?.subscribe((call, session) => {
      const requestId = this.activeRequestBySession.get(session.id);
      if (!requestId || this.closed) return;
      this.send({
        type: "approval_request",
        requestId,
        sessionId: session.id,
        callId: call.id,
        tool: call.name,
        input: call.input,
      });
    });
  }

  async handleLine(line: string): Promise<"continue" | "shutdown"> {
    if (this.closed) return "shutdown";
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch {
      this.sendError(
        "invalid_json",
        "Invalid JSON request. Send one JSON object per line.",
      );
      return "continue";
    }

    let request = protocolObject(value);
    if (request?.jsonrpc === "2.0") {
      if (this.wireMode === "legacy") {
        this.sendError(
          "invalid_request",
          "A connection cannot mix legacy and JSON-RPC messages.",
          typeof request.id === "string" ? request.id : undefined,
        );
        return "continue";
      }
      this.wireMode = "jsonrpc";
      request = this.jsonRpcRequest(request);
    } else {
      if (this.wireMode === "jsonrpc") {
        this.sendError(
          "invalid_request",
          "A connection cannot mix JSON-RPC and legacy messages.",
          typeof request?.requestId === "string"
            ? request.requestId
            : undefined,
        );
        return "continue";
      }
      this.wireMode = "legacy";
    }
    const requestId = request?.requestId;
    if (!request || typeof request.type !== "string") {
      this.sendError("invalid_request", "A service request needs a type.");
      return "continue";
    }
    if (!validRequestId(requestId)) {
      this.sendError(
        "invalid_request",
        "A service request needs a non-empty requestId.",
      );
      return "continue";
    }

    if (request.type === "initialize") {
      this.initialize(requestId, request);
      return "continue";
    }
    if (
      !this.initialized &&
      (this.wireMode === "jsonrpc" ||
        this.options.allowLegacyRequests === false)
    ) {
      this.sendError(
        "invalid_request",
        "Initialize the local service before sending requests.",
        requestId,
      );
      return "continue";
    }

    try {
      if (request.type === "ping") {
        this.send({
          type: "response",
          requestId,
          result: { pong: true },
        });
        return "continue";
      }
      if (request.type === "shutdown") {
        this.send({
          type: "response",
          requestId,
          result: { shutdown: true },
        });
        return "shutdown";
      }
      if (request.type === "create_session") {
        await this.createSession(requestId, request.messages);
        return "continue";
      }
      if (request.type === "run") {
        this.startRun(requestId, request);
        return "continue";
      }
      if (request.type === "abort") {
        this.cancel(requestId, true);
        return "continue";
      }
      if (request.type === "cancel") {
        if (!validRequestId(request.targetRequestId))
          throw new Error("A cancel request needs a targetRequestId.");
        const cancelled = this.cancel(request.targetRequestId, false);
        this.send({
          type: "response",
          requestId,
          result: {
            cancelled,
            targetRequestId: request.targetRequestId,
          },
        });
        return "continue";
      }
      if (request.type === "tool_approval") {
        if (
          typeof request.callId !== "string" ||
          typeof request.approved !== "boolean"
        )
          throw new Error(
            "A tool approval needs a callId and approved boolean.",
          );
        if (!this.options.approval?.resolve(request.callId, request.approved))
          this.sendError(
            "unknown_request",
            "No tool approval is pending for that call.",
            requestId,
          );
        else if (this.wireMode === "jsonrpc")
          this.send({
            type: "response",
            requestId,
            result: { approvalResolved: true },
          });
        return "continue";
      }
      if (request.type === "test_provider") {
        const testProviderConnection =
          this.options.host?.testProviderConnection;
        if (!testProviderConnection)
          return this.unavailableCapability(
            requestId,
            "Provider connection testing",
          );
        await this.hostResponse(requestId, async () => ({
          providerConnection: await testProviderConnection(),
        }));
        return "continue";
      }
      if (request.type === "list_profiles") {
        const listProfiles = this.options.host?.listProfiles;
        if (!listProfiles)
          return this.unavailableCapability(requestId, "Profile discovery");
        await this.hostResponse(requestId, async () => ({
          profiles: await listProfiles(),
        }));
        return "continue";
      }
      if (request.type === "mcp_status") {
        const listMcpServers = this.options.host?.listMcpServers;
        if (!listMcpServers)
          return this.unavailableCapability(requestId, "MCP status");
        await this.hostResponse(requestId, async () => ({
          mcpServers: await listMcpServers(),
        }));
        return "continue";
      }
    } catch (error) {
      this.sendError("invalid_request", requestError(error), requestId);
      return "continue";
    }

    this.sendError(
      this.wireMode === "jsonrpc" ? "method_not_found" : "invalid_request",
      `Unknown service request type: ${request.type}`,
      requestId,
    );
    return "continue";
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe();
    this.unsubscribeApproval?.();
    for (const controller of this.controllers.values()) controller.abort();
    this.options.approval?.denyAll();
    if (this.activeRuns.size) {
      await Promise.race([
        Promise.allSettled([...this.activeRuns]),
        new Promise((resolve) => setTimeout(resolve, 1_000)),
      ]);
    }
    this.controllers.clear();
    this.requestSessions.clear();
    this.activeRequestBySession.clear();
    this.activeRequestIds.clear();
  }

  private initialize(
    requestId: string,
    request: Record<string, unknown>,
  ): void {
    if (
      !Array.isArray(request.protocolVersions) ||
      !request.protocolVersions.every(
        (version) => Number.isInteger(version) && version > 0,
      )
    ) {
      this.sendError(
        "invalid_request",
        "Initialize requires a protocolVersions array.",
        requestId,
      );
      return;
    }
    const protocolVersion = [...request.protocolVersions]
      .sort((left, right) => Number(right) - Number(left))
      .find((version) =>
        LOCAL_SERVICE_PROTOCOL_VERSIONS.includes(
          version as (typeof LOCAL_SERVICE_PROTOCOL_VERSIONS)[number],
        ),
      );
    if (!protocolVersion) {
      this.send({
        type: "error",
        requestId,
        code: "unsupported_protocol",
        message:
          "The client and local service have no shared protocol version.",
        supportedProtocolVersions: LOCAL_SERVICE_PROTOCOL_VERSIONS,
      });
      return;
    }
    this.initialized = true;
    this.send({
      type: "response",
      requestId,
      result: {
        protocolVersion,
        server: {
          name: "truss-cli",
          version: this.options.serverVersion ?? "development",
        },
        capabilities: this.capabilities,
      },
    });
  }

  private jsonRpcRequest(
    request: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    if (!validRequestId(request.id) || typeof request.method !== "string") {
      this.sendError(
        "invalid_request",
        "A JSON-RPC request needs a string id and method.",
        typeof request.id === "string" ? request.id : undefined,
      );
      return undefined;
    }
    const params =
      request.params === undefined ? {} : protocolObject(request.params);
    if (!params) {
      this.sendError(
        "invalid_request",
        "JSON-RPC params must be an object.",
        request.id,
      );
      return undefined;
    }
    const common = { ...params, requestId: request.id };
    if (request.method === "initialize")
      return { ...common, type: "initialize" };
    if (request.method === "session/create")
      return { ...common, type: "create_session" };
    if (request.method === "run/start") return { ...common, type: "run" };
    if (request.method === "run/cancel") return { ...common, type: "cancel" };
    if (request.method === "approval/resolve")
      return { ...common, type: "tool_approval" };
    if (request.method === "provider/test")
      return { ...common, type: "test_provider" };
    if (request.method === "profiles/list")
      return { ...common, type: "list_profiles" };
    if (request.method === "mcp/status")
      return { ...common, type: "mcp_status" };
    if (request.method === "service/ping") return { ...common, type: "ping" };
    if (request.method === "service/shutdown")
      return { ...common, type: "shutdown" };
    return { ...common, type: request.method };
  }

  private async createSession(
    requestId: string,
    messages: unknown,
  ): Promise<void> {
    const sanitized = sanitizeMessages(messages);
    try {
      const session = await this.options.runtime.createSession(sanitized);
      this.send({
        type: "response",
        requestId,
        result: { sessionId: session.id },
      });
    } catch (error) {
      this.sendError("internal_error", requestError(error), requestId);
    }
  }

  private startRun(requestId: string, request: Record<string, unknown>): void {
    const prompt = sanitizePrompt(request.prompt);
    if (
      request.sessionId !== undefined &&
      typeof request.sessionId !== "string"
    )
      throw new Error("A run sessionId must be a string.");
    if (this.activeRequestIds.has(requestId))
      throw new Error("That requestId already has an active run.");

    const context = sanitizeContext(request.context);
    const attachments = sanitizeAttachments(request.attachments);
    this.activeRequestIds.add(requestId);
    const run = this.run({
      requestId,
      prompt,
      sessionId:
        typeof request.sessionId === "string" ? request.sessionId : undefined,
      context,
      attachments,
    });
    this.activeRuns.add(run);
    void run.then(
      () => this.activeRuns.delete(run),
      () => this.activeRuns.delete(run),
    );
  }

  private async run(input: {
    readonly requestId: string;
    readonly prompt: string;
    readonly sessionId?: string;
    readonly context: readonly ContextBlock[];
    readonly attachments: readonly ChatAttachment[];
  }): Promise<void> {
    let sessionId: string | undefined;
    try {
      const session = input.sessionId
        ? await this.options.runtime.getSession(input.sessionId)
        : await this.options.runtime.createSession();
      if (this.closed) return;
      if (!session) {
        this.sendError(
          "unknown_request",
          `Unknown session: ${input.sessionId}`,
          input.requestId,
        );
        return;
      }
      sessionId = session.id;
      if (this.activeRequestBySession.has(sessionId)) {
        this.sendError(
          "request_conflict",
          "That session already has an active run.",
          input.requestId,
        );
        return;
      }
      const controller = new AbortController();
      this.controllers.set(input.requestId, controller);
      this.requestSessions.set(input.requestId, sessionId);
      this.activeRequestBySession.set(sessionId, input.requestId);
      this.send({
        type: "lifecycle",
        requestId: input.requestId,
        state: "started",
        sessionId,
      });
      await this.options.runtime.run(
        sessionId,
        input.prompt,
        controller.signal,
        input.context,
        input.attachments,
      );
      if (this.closed) return;
      this.send({
        type: "lifecycle",
        requestId: input.requestId,
        state: controller.signal.aborted ? "cancelled" : "completed",
        sessionId,
      });
      this.send({
        type: "response",
        requestId: input.requestId,
        result: {
          sessionId,
          ...(controller.signal.aborted ? { aborted: true } : {}),
        },
      });
    } catch (error) {
      if (this.closed) return;
      const controller = this.controllers.get(input.requestId);
      if (controller?.signal.aborted) {
        this.send({
          type: "lifecycle",
          requestId: input.requestId,
          state: "cancelled",
          ...(sessionId ? { sessionId } : {}),
        });
        this.send({
          type: "response",
          requestId: input.requestId,
          result: {
            ...(sessionId ? { sessionId } : {}),
            aborted: true,
          },
        });
      } else {
        this.send({
          type: "lifecycle",
          requestId: input.requestId,
          state: "failed",
          ...(sessionId ? { sessionId } : {}),
        });
        this.sendError("internal_error", requestError(error), input.requestId);
      }
    } finally {
      this.controllers.delete(input.requestId);
      this.requestSessions.delete(input.requestId);
      this.activeRequestIds.delete(input.requestId);
      if (
        sessionId &&
        this.activeRequestBySession.get(sessionId) === input.requestId
      )
        this.activeRequestBySession.delete(sessionId);
    }
  }

  private cancel(requestId: string, reportUnknown: boolean): boolean {
    const controller = this.controllers.get(requestId);
    if (!controller) {
      if (reportUnknown)
        this.sendError("unknown_request", "Unknown active request.", requestId);
      return false;
    }
    controller.abort();
    const sessionId = this.requestSessions.get(requestId);
    if (sessionId) this.options.approval?.denySession(sessionId);
    return true;
  }

  private send(message: RuntimeServiceMessage): void {
    if (this.closed) return;
    this.options.write(
      this.wireMode === "jsonrpc" ? this.jsonRpcMessage(message) : message,
    );
  }

  private jsonRpcMessage(
    message: RuntimeServiceMessage,
  ): RuntimeServiceJsonRpcMessage {
    if (message.type === "response")
      return {
        jsonrpc: "2.0",
        id: message.requestId,
        result: message.result,
      };
    if (message.type === "error")
      return {
        jsonrpc: "2.0",
        id: message.requestId ?? null,
        error: {
          code: jsonRpcErrorCode(message.code),
          message: message.message,
          data: {
            code: message.code,
            ...(message.supportedProtocolVersions
              ? {
                  supportedProtocolVersions: message.supportedProtocolVersions,
                }
              : {}),
          },
        },
      };
    if (message.type === "event")
      return {
        jsonrpc: "2.0",
        method: "runtime/event",
        params: {
          requestId: message.requestId,
          event: message.event,
        },
      };
    if (message.type === "approval_request")
      return {
        jsonrpc: "2.0",
        method: "approval/requested",
        params: {
          requestId: message.requestId,
          sessionId: message.sessionId,
          callId: message.callId,
          tool: message.tool,
          input: message.input,
        },
      };
    return {
      jsonrpc: "2.0",
      method: "run/lifecycle",
      params: {
        requestId: message.requestId,
        state: message.state,
        ...(message.sessionId ? { sessionId: message.sessionId } : {}),
      },
    };
  }

  private sendError(
    code: RuntimeServiceErrorCode,
    message: string,
    requestId?: string,
  ): void {
    this.send({
      type: "error",
      ...(requestId ? { requestId } : {}),
      code,
      message,
    });
  }

  private unavailableCapability(
    requestId: string,
    capability: string,
  ): "continue" {
    this.sendError(
      "method_not_found",
      `${capability} is unavailable from this service.`,
      requestId,
    );
    return "continue";
  }

  private async hostResponse(
    requestId: string,
    load: () => Promise<RuntimeServiceResult>,
  ): Promise<void> {
    try {
      this.send({
        type: "response",
        requestId,
        result: await load(),
      });
    } catch (error) {
      this.sendError("internal_error", requestError(error), requestId);
    }
  }
}

function jsonRpcErrorCode(code: RuntimeServiceErrorCode): number {
  if (code === "invalid_json") return -32700;
  if (code === "invalid_request") return -32600;
  if (code === "method_not_found") return -32601;
  if (code === "internal_error") return -32603;
  if (code === "unsupported_protocol") return -32010;
  if (code === "request_conflict") return -32009;
  return -32004;
}

/** Starts the versioned newline-delimited JSON service over process stdio. */
export async function runService(
  runtime: RuntimeServiceRuntime,
  events: RuntimeServiceEventSource,
  approval?: ProtocolToolApproval,
  options: {
    readonly serverVersion?: string;
    readonly capabilities?: Partial<RuntimeServiceCapabilities>;
    readonly host?: RuntimeServiceHost;
  } = {},
): Promise<void> {
  const service = new RuntimeService({
    runtime,
    events,
    approval,
    write: (message) => stdout.write(`${JSON.stringify(message)}\n`),
    serverVersion: options.serverVersion,
    capabilities: options.capabilities,
    host: options.host,
  });
  const lines = createInterface({ input: stdin, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if ((await service.handleLine(line)) === "shutdown") break;
    }
  } finally {
    lines.close();
    await service.close();
  }
}
