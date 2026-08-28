import type { ProtocolToolApproval } from "./protocol/approval.js";
import {
  serializeEvent,
  serviceCapabilities,
} from "./protocol/capabilities.js";
import { RunRegistry } from "./protocol/run-registry.js";
import { jsonRpcMessage } from "./protocol/wire.js";
import {
  RUNTIME_PACKAGE_NAME,
  RUNTIME_VERSION,
} from "@truss-harness/runtime";
import {
  LOCAL_SERVICE_PROTOCOL_VERSIONS,
  type RuntimeServiceCapabilities,
  type RuntimeServiceErrorCode,
  type RuntimeServiceEventSource,
  type RuntimeServiceHost,
  type RuntimeServiceMessage,
  type RuntimeServiceResult,
  type RuntimeServiceRuntime,
  type RuntimeServiceWireMessage,
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

export { ProtocolToolApproval } from "./protocol/approval.js";
export * from "./protocol-contracts.js";
export { validateRuntimeServiceHandshake } from "./protocol/compatibility.js";
export {
  activateRuntimeHost,
  installRuntimeHostArtifact,
  parseRuntimeHostManifest,
  readRuntimeHostActivation,
  rollbackRuntimeHost,
  verifyRuntimeHostArtifact,
  runtimeHostStorePath,
} from "./runtime-delivery.js";
export type {
  RuntimeHostActivation,
  RuntimeHostManifest,
} from "./runtime-delivery.js";

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

/**
 * Stateful, transport-independent local service. Clients exchange one JSON
 * object per line; the class owns request routing and deterministic cleanup.
 */
export class RuntimeService {
  private readonly runs: RunRegistry;
  private readonly unsubscribe: () => void;
  private readonly unsubscribeApproval?: () => void;
  private readonly capabilities: RuntimeServiceCapabilities;
  private initialized = false;
  private closed = false;
  private wireMode: "legacy" | "jsonrpc" | undefined;

  constructor(private readonly options: RuntimeServiceOptions) {
    this.capabilities = serviceCapabilities(options);
    this.runs = new RunRegistry({
      runtime: options.runtime,
      send: (message) => this.send(message),
      sendError: (code, message, requestId) =>
        this.sendError(code, message, requestId),
      denySession: (sessionId) => options.approval?.denySession(sessionId),
      isClosed: () => this.closed,
    });
    this.unsubscribe = options.events.subscribe((event) => {
      const requestId = this.runs.requestForSession(event.sessionId);
      if (!requestId || this.closed) return;
      this.send({
        type: "event",
        requestId,
        event: serializeEvent(event),
      });
    });
    this.unsubscribeApproval = options.approval?.subscribe((call, session) => {
      const requestId = this.runs.requestForSession(session.id);
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
    await this.runs.close();
    this.options.approval?.denyAll();
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
          identity: {
            runtime: {
              packageName: RUNTIME_PACKAGE_NAME,
              version: RUNTIME_VERSION,
            },
            protocolVersions: LOCAL_SERVICE_PROTOCOL_VERSIONS,
          },
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
    const context = sanitizeContext(request.context);
    const attachments = sanitizeAttachments(request.attachments);
    this.runs.start({
      requestId,
      prompt,
      sessionId:
        typeof request.sessionId === "string" ? request.sessionId : undefined,
      context,
      attachments,
    });
  }

  private cancel(requestId: string, reportUnknown: boolean): boolean {
    const cancelled = this.runs.cancel(requestId);
    if (!cancelled) {
      if (reportUnknown)
        this.sendError("unknown_request", "Unknown active request.", requestId);
      return false;
    }
    return true;
  }

  private send(message: RuntimeServiceMessage): void {
    if (this.closed) return;
    this.options.write(
      this.wireMode === "jsonrpc" ? jsonRpcMessage(message) : message,
    );
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

export { runService } from "./protocol/stdio.js";
