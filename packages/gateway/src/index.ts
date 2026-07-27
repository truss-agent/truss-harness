import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { AgentCoordinator, AgentCoordinatorEvent, AgentRunSummary, AgentRuntime, RemoteAgentAction, RemoteAgentEvent, RemoteAgentProfile, RemoteAgentRunSummary, RemoteCommandResult, RemoteHostCapabilities, RemoteToolApprovalMode, RemoteWorkspace, RuntimeEvent, ToolApproval } from "@truss-harness/runtime";
import { toRemoteSessionEvent } from "@truss-harness/runtime";
export { createPairingUri, detectLanAddress } from "./pairing.js";

export interface GatewayRuntime {
  readonly runtime: AgentRuntime;
  readonly events: { subscribe(listener: (event: RuntimeEvent) => void): () => void };
  readonly approval?: ToolApproval & { resolve?(callId: string, approved: boolean): boolean; denyAll?(): void };
  dispose?(): Promise<void>;
}

/** Optional managed-agent surface made available to trusted remote clients. */
export interface GatewayAgentController {
  /** Deliberately delegated actions for the paired client. Listing permitted profiles is always read-only. */
  readonly access: {
    readonly canStart: boolean;
    readonly canStop: boolean;
    readonly canResolveApproval: boolean;
  };
  readonly events: { subscribe(listener: (event: AgentCoordinatorEvent) => void): () => void };
  listProfiles(): Promise<readonly RemoteAgentProfile[]>;
  listRuns(): readonly RemoteAgentRunSummary[];
  start(input: { readonly agentId: string; readonly prompt: string; readonly attachments?: readonly import("@truss-harness/runtime").ChatAttachment[] }): Promise<RemoteAgentRunSummary>;
  stop(runId: string): Promise<RemoteAgentRunSummary>;
  resolveApproval(runId: string, callId: string, approved: boolean): Promise<boolean>;
}

export interface GatewayAgentAccessOptions {
  /** Undefined exposes all profiles; provide IDs to expose only a selected subset. */
  readonly allowedProfileIds?: readonly string[];
  /** Starting a run is opt-in because it can invoke tools on the paired host. */
  readonly allowStart?: boolean;
  /** Stopping a visible run is allowed by default. */
  readonly allowStop?: boolean;
  /** Resolving a visible run's pending tool approval is allowed by default. */
  readonly allowApproval?: boolean;
}

class GatewayAgentAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GatewayAgentAccessError";
  }
}

function remoteProfile(profile: Awaited<ReturnType<AgentCoordinator["listProfiles"]>>[number]): RemoteAgentProfile {
  return {
    id: profile.id,
    displayName: profile.displayName,
    providerId: profile.provider.providerId,
    modelId: profile.provider.modelId,
    mode: profile.mode,
    approvalPolicy: profile.approvalPolicy,
    internetAccess: profile.internetAccess,
  };
}

function remoteRun(run: AgentRunSummary): RemoteAgentRunSummary {
  return {
    id: run.id,
    agentId: run.agentId,
    ...(run.sessionId ? { sessionId: run.sessionId } : {}),
    state: run.state,
    ...(run.startedAt ? { startedAt: run.startedAt } : {}),
    ...(run.completedAt ? { completedAt: run.completedAt } : {}),
    ...(run.latestProgress ? { latestProgress: run.latestProgress } : {}),
    ...(run.output ? { output: run.output } : {}),
    ...(run.activeTool ? { activeTool: run.activeTool } : {}),
    changedFiles: run.changedFiles,
    ...(run.error ? { errorCode: run.error.code } : {}),
  };
}

/** Adapts the runtime coordinator without exposing prompts, instructions, credentials, or endpoint URLs. */
export function createGatewayAgentController(
  coordinator: AgentCoordinator,
  options: GatewayAgentAccessOptions = {},
): GatewayAgentController {
  const allowedProfileIds = options.allowedProfileIds
    ? new Set(options.allowedProfileIds)
    : undefined;
  const visible = (agentId: string): boolean =>
    !allowedProfileIds || allowedProfileIds.has(agentId);
  const access = {
    canStart: options.allowStart === true,
    canStop: options.allowStop !== false,
    canResolveApproval: options.allowApproval !== false,
  };
  return {
    access,
    events: coordinator.events,
    async listProfiles() {
      return (await coordinator.listProfiles())
        .filter((profile) => visible(profile.id))
        .map(remoteProfile);
    },
    listRuns() {
      return coordinator.listRuns()
        .filter((run) => visible(run.agentId))
        .map(remoteRun);
    },
    async start(input) {
      if (!access.canStart || !visible(input.agentId))
        throw new GatewayAgentAccessError("Starting this agent is not authorized for the paired client.");
      return remoteRun(await coordinator.start(input));
    },
    async stop(runId) {
      const run = coordinator.getRun(runId);
      if (!access.canStop || !run || !visible(run.agentId))
        throw new GatewayAgentAccessError("Stopping this agent run is not authorized for the paired client.");
      return remoteRun(await coordinator.stop(runId));
    },
    async resolveApproval(runId, callId, approved) {
      const run = coordinator.getRun(runId);
      if (!access.canResolveApproval || !run || !visible(run.agentId)) return false;
      return coordinator.resolveApproval(runId, callId, approved);
    },
  };
}

function agentActions(agents: GatewayAgentController): readonly RemoteAgentAction[] {
  return [
    ...(agents.access.canStart ? ["start" as const] : []),
    ...(agents.access.canStop ? ["stop" as const] : []),
    ...(agents.access.canResolveApproval ? ["approve" as const] : []),
  ];
}

/** A host-configured workspace. The root path remains private to the host. */
export interface GatewayWorkspace {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities?: RemoteHostCapabilities;
  readonly agents?: GatewayAgentController;
  readonly createRuntime: (mode: "chat" | "plan" | "edit", toolApprovalMode?: RemoteToolApprovalMode) => Promise<GatewayRuntime>;
}

export interface RemoteGatewayOptions {
  /** A high-entropy token configured by the workspace host. Do not expose this server publicly without TLS and pairing. */
  readonly token: string;
  readonly workspaces: readonly GatewayWorkspace[];
  /** Loopback by default. Binding beyond loopback is intentionally explicit and remains suitable only for trusted networks. */
  readonly host?: string;
  readonly port?: number;
}

export interface RunningRemoteGateway {
  readonly url: string;
  close(): Promise<void>;
}

interface SessionContext {
  readonly runtime: GatewayRuntime;
  readonly workspace: ConfiguredWorkspace;
  readonly protocolVersion: number;
  controller?: AbortController;
}

interface ConfiguredWorkspace {
  readonly remote: RemoteWorkspace;
  readonly agents?: GatewayAgentController;
  readonly createRuntime: GatewayWorkspace["createRuntime"];
}

const defaultCapabilities: RemoteHostCapabilities = {
  protocolVersions: [1, 2],
  modes: ["chat", "plan", "edit"],
  toolApprovalModes: ["ask", "auto-read", "auto-all"],
  supportsAttachments: false,
  supportsDiffs: false,
  supportsToolApproval: true,
  supportsAgents: false,
  agentActions: []
};

function isApprovalMode(value: unknown): value is RemoteToolApprovalMode {
  return value === "ask" || value === "auto-read" || value === "auto-all";
}

function agentErrorCode(error: unknown): "invalid_command" | "not_authorized" | "not_found" | "conflict" {
  if (error instanceof GatewayAgentAccessError) return "not_authorized";
  if (error && typeof error === "object" && "code" in error) {
    if (error.code === "not_found") return "not_found";
    if (error.code === "conflict") return "conflict";
  }
  return "invalid_command";
}

function hasToken(candidate: string, expectedToken: string): boolean {
  const actual = Buffer.from(candidate);
  const expected = Buffer.from(expectedToken);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Starts a small HTTP/WebSocket adapter for the remote-session contract. It is
 * intended for loopback development or a user-managed secure tunnel; it does
 * not claim to provide internet-facing device pairing or TLS termination.
 */
export async function startRemoteGateway(options: RemoteGatewayOptions): Promise<RunningRemoteGateway> {
  if (options.token.length < 24) throw new Error("Gateway token must contain at least 24 characters.");
  if (!options.workspaces.length) throw new Error("Configure at least one gateway workspace.");
  const workspaces = new Map<string, ConfiguredWorkspace>();
  for (const workspace of options.workspaces) {
    if (!workspace.id || workspaces.has(workspace.id)) throw new Error("Each gateway workspace needs a unique non-empty id.");
    const capabilities = {
      ...(workspace.capabilities ?? defaultCapabilities),
      ...(workspace.agents
        ? { supportsAgents: true, agentActions: agentActions(workspace.agents) }
        : {}),
    };
    workspaces.set(workspace.id, {
      remote: { id: workspace.id, displayName: workspace.displayName, capabilities },
      ...(workspace.agents ? { agents: workspace.agents } : {}),
      createRuntime: workspace.createRuntime,
    });
  }
  const supportedProtocolVersions = [...new Set([...workspaces.values()].flatMap((workspace) => workspace.remote.capabilities.protocolVersions))].sort((left, right) => right - left);

  const sessions = new Map<string, SessionContext>();
  const sseClients = new Map<ServerResponse, number>();
  const webSocketClients = new Map<WebSocket, number>();
  const cleanups = new Set<() => void>();
  const runtimes = new Set<GatewayRuntime>();
  let sequence = 0;

  const broadcastPayload = (event: unknown, minimumVersion = 1): void => {
    const payload = JSON.stringify(event);
    for (const [client, protocolVersion] of sseClients) if (protocolVersion >= minimumVersion) client.write(`event: remote-session\ndata: ${payload}\n\n`);
    for (const [client, protocolVersion] of webSocketClients) if (protocolVersion >= minimumVersion && client.readyState === WebSocket.OPEN) client.send(payload);
  };
  const broadcast = (event: RuntimeEvent): void => broadcastPayload(toRemoteSessionEvent(event, ++sequence));
  const broadcastAgentEvent = (workspaceId: string, event: AgentCoordinatorEvent): void => {
    if (event.type === "lifecycle") return;
    const remoteEvent: RemoteAgentEvent = event.type === "run_updated"
      ? { version: 2, sequence: ++sequence, type: "agent_run_updated", workspaceId, run: remoteRun(event.run) }
      : {
          version: 2,
          sequence: ++sequence,
          type: "agent_runtime",
          workspaceId,
          agentId: event.event.agentId,
          runId: event.event.runId,
          runSequence: event.event.sequence,
          occurredAt: event.event.occurredAt,
          event: toRemoteSessionEvent(event.event.event, event.event.sequence),
        };
    broadcastPayload(remoteEvent, 2);
  };

  for (const workspace of workspaces.values()) {
    if (workspace.agents) cleanups.add(workspace.agents.events.subscribe((event) => broadcastAgentEvent(workspace.remote.id, event)));
  }

  const authorize = (request: IncomingMessage): boolean => {
    const authorization = request.headers.authorization;
    return authorization?.startsWith("Bearer ") === true && hasToken(authorization.slice("Bearer ".length), options.token);
  };

  const negotiateVersion = (requestedVersions: readonly number[]): number | undefined =>
    supportedProtocolVersions.find((version) => requestedVersions.includes(version));

  const reply = (response: ServerResponse, status: number, body: unknown): void => {
    response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    response.end(`${JSON.stringify(body)}\n`);
  };

  const reject = (requestId: string, code: Extract<RemoteCommandResult, { type: "rejected" }>["code"], message: string): RemoteCommandResult => ({ requestId, type: "rejected", code, message });

  const addRuntime = (runtime: GatewayRuntime): void => {
    if (runtimes.has(runtime)) return;
    runtimes.add(runtime);
    cleanups.add(runtime.events.subscribe(broadcast));
  };

  const readCommand = async (request: IncomingMessage): Promise<unknown> => {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > 1_048_576) throw new Error("Request body exceeds 1 MiB.");
      chunks.push(buffer);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  };

  const command = async (value: unknown): Promise<RemoteCommandResult> => {
    if (!value || typeof value !== "object") return reject("unknown", "invalid_command", "Command must be a JSON object.");
    const input = value as Record<string, unknown>;
    const requestId = typeof input.requestId === "string" ? input.requestId : "unknown";
    if ((input.version !== 1 && input.version !== 2) || typeof input.type !== "string") return reject(requestId, "invalid_command", "Unsupported remote-session command.");

    const agentWorkspace = (): { readonly workspace: ConfiguredWorkspace; readonly agents: GatewayAgentController } | RemoteCommandResult => {
      const workspace = typeof input.workspaceId === "string" ? workspaces.get(input.workspaceId) : undefined;
      if (!workspace?.agents || !workspace.remote.capabilities.supportsAgents) return reject(requestId, "not_authorized", "Managed agents are unavailable for this workspace.");
      return { workspace, agents: workspace.agents };
    };
    if (input.type === "list_agents" || input.type === "start_agent" || input.type === "stop_agent" || input.type === "resolve_agent_approval") {
      if (input.version !== 2) return reject(requestId, "invalid_command", "Managed-agent commands require protocol version 2.");
      const agentTarget = agentWorkspace();
      if ("type" in agentTarget) return agentTarget;
      const { workspace, agents } = agentTarget;
      if (!workspace.remote.capabilities.protocolVersions.includes(2)) return reject(requestId, "not_authorized", "This workspace does not support remote protocol version 2.");
      if (input.type === "list_agents") return { requestId, type: "agents_listed", profiles: await agents.listProfiles(), runs: agents.listRuns() };
      if (input.type === "start_agent") {
        if (!agents.access.canStart) return reject(requestId, "not_authorized", "Starting managed agents is disabled by the paired host.");
        if (typeof input.agentId !== "string" || typeof input.prompt !== "string" || !input.prompt.trim()) return reject(requestId, "invalid_command", "An agentId and non-empty prompt are required.");
        try { return { requestId, type: "agent_run", run: await agents.start({ agentId: input.agentId, prompt: input.prompt, ...(Array.isArray(input.attachments) ? { attachments: input.attachments as readonly import("@truss-harness/runtime").ChatAttachment[] } : {}) }) }; }
        catch (error) { return reject(requestId, agentErrorCode(error), error instanceof Error ? error.message : "Unable to start agent."); }
      }
      if (input.type === "stop_agent") {
        if (!agents.access.canStop) return reject(requestId, "not_authorized", "Stopping managed agents is disabled by the paired host.");
        if (typeof input.runId !== "string") return reject(requestId, "invalid_command", "A runId is required.");
        try { return { requestId, type: "agent_run", run: await agents.stop(input.runId) }; }
        catch (error) { return reject(requestId, agentErrorCode(error), error instanceof Error ? error.message : "Unable to stop agent."); }
      }
      if (!agents.access.canResolveApproval) return reject(requestId, "not_authorized", "Approving managed-agent tools is disabled by the paired host.");
      if (typeof input.runId !== "string" || typeof input.callId !== "string" || typeof input.approved !== "boolean") return reject(requestId, "invalid_command", "An agent approval requires runId, callId, and approved.");
      if (!await agents.resolveApproval(input.runId, input.callId, input.approved)) return reject(requestId, "not_found", "No pending approval matches that call.");
      return { requestId, type: "accepted" };
    }

    if (input.type === "create_session") {
      const workspace = typeof input.workspaceId === "string" ? workspaces.get(input.workspaceId) : undefined;
      if (!workspace?.remote.capabilities.protocolVersions.includes(input.version as 1 | 2) || (input.mode !== "chat" && input.mode !== "plan" && input.mode !== "edit") || !workspace.remote.capabilities.modes.includes(input.mode)) {
        return reject(requestId, "not_authorized", "The requested workspace or mode is unavailable.");
      }
      if (input.toolApprovalMode !== undefined && (!isApprovalMode(input.toolApprovalMode) || !workspace.remote.capabilities.toolApprovalModes.includes(input.toolApprovalMode))) {
        return reject(requestId, "not_authorized", "The requested tool approval mode is unavailable.");
      }
      const runtime = await workspace.createRuntime(input.mode, input.toolApprovalMode);
      const session = await runtime.runtime.createSession();
      addRuntime(runtime);
      sessions.set(session.id, { runtime, workspace, protocolVersion: input.version });
      return { requestId, type: "session_created", sessionId: session.id };
    }

    if (typeof input.sessionId !== "string") return reject(requestId, "invalid_command", "A sessionId is required.");
    const session = sessions.get(input.sessionId);
    if (!session) return reject(requestId, "not_found", "Unknown remote session.");
    if (session.protocolVersion !== input.version) return reject(requestId, "invalid_command", "Use the protocol version negotiated when this session was created.");

    if (input.type === "change_session_mode") {
      if (session.controller) return reject(requestId, "conflict", "The session already has an active run.");
      if ((input.mode !== "chat" && input.mode !== "plan" && input.mode !== "edit") || !session.workspace.remote.capabilities.modes.includes(input.mode)) {
        return reject(requestId, "not_authorized", "The requested mode is unavailable.");
      }
      if (input.toolApprovalMode !== undefined && (!isApprovalMode(input.toolApprovalMode) || !session.workspace.remote.capabilities.toolApprovalModes.includes(input.toolApprovalMode))) {
        return reject(requestId, "not_authorized", "The requested tool approval mode is unavailable.");
      }
      const previous = await session.runtime.runtime.getSession(input.sessionId);
      if (!previous) return reject(requestId, "not_found", "The remote session is no longer available.");
      const runtime = await session.workspace.createRuntime(input.mode, input.toolApprovalMode);
      const replacement = await runtime.runtime.createSession(previous.messages);
      addRuntime(runtime);
      sessions.delete(input.sessionId);
      sessions.set(replacement.id, { runtime, workspace: session.workspace, protocolVersion: session.protocolVersion });
      return { requestId, type: "session_created", sessionId: replacement.id };
    }

    if (input.type === "send_message") {
      if (typeof input.prompt !== "string" || !input.prompt.trim()) return reject(requestId, "invalid_command", "A non-empty prompt is required.");
      if (session.controller) return reject(requestId, "conflict", "The session already has an active run.");
      const controller = new AbortController();
      session.controller = controller;
      void session.runtime.runtime.run(input.sessionId, input.prompt, controller.signal)
        .catch(() => undefined)
        .finally(() => { session.controller = undefined; });
      return { requestId, type: "accepted" };
    }

    if (input.type === "approve_tool") {
      if (typeof input.callId !== "string" || typeof input.approved !== "boolean") return reject(requestId, "invalid_command", "A tool approval requires callId and approved.");
      if (!session.runtime.approval?.resolve?.(input.callId, input.approved)) return reject(requestId, "not_found", "No pending approval matches that call.");
      return { requestId, type: "accepted" };
    }

    if (input.type === "interrupt") {
      if (!session.controller) return reject(requestId, "conflict", "The session has no active run.");
      session.controller.abort();
      session.runtime.approval?.denyAll?.();
      return { requestId, type: "accepted" };
    }

    return reject(requestId, "invalid_command", "Unsupported remote-session command.");
  };

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (request.method === "GET" && url.pathname === "/health") return reply(response, 200, { ok: true });
    if (!authorize(request)) return reply(response, 401, { error: "Unauthorized" });

    if (request.method === "GET" && url.pathname === "/v1/workspaces") {
      return reply(response, 200, { workspaces: [...workspaces.values()].map(({ remote }) => remote) });
    }
    if (request.method === "GET" && url.pathname === "/v1/events") {
      const versionHeader = request.headers["truss-protocol-versions"];
      const requestedVersions = (typeof versionHeader === "string" ? versionHeader.split(",").map(Number).filter(Number.isFinite) : [1]);
      const protocolVersion = negotiateVersion(requestedVersions);
      if (!protocolVersion) return reply(response, 426, { error: "No shared remote protocol version." });
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" });
      response.write(": connected\n\n");
      sseClients.set(response, protocolVersion);
      request.on("close", () => sseClients.delete(response));
      return;
    }
    if (request.method === "POST" && url.pathname === "/v1/commands") {
      try {
        const result = await command(await readCommand(request));
        return reply(response, result.type === "rejected" ? 400 : 200, result);
      } catch (error) {
        return reply(response, 400, reject("unknown", "invalid_command", error instanceof Error ? error.message : "Invalid command."));
      }
    }
    return reply(response, 404, { error: "Not found" });
  });

  const webSockets = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname !== "/v1/events") return socket.destroy();
    webSockets.handleUpgrade(request, socket, head, (client) => {
      const timeout = setTimeout(() => client.close(1008, "Authentication timed out."), 5_000);
      client.once("message", (data) => {
        let handshake: unknown;
        try { handshake = JSON.parse(data.toString()) as unknown; } catch { client.close(1008, "Invalid authentication payload."); return; }
        const input = handshake && typeof handshake === "object" ? handshake as Record<string, unknown> : undefined;
        if (input?.type !== "authenticate" || typeof input.token !== "string" || !hasToken(input.token, options.token)) {
          client.close(1008, "Unauthorized.");
          return;
        }
        const requestedVersions = input.protocolVersions === undefined
          ? [1]
          : Array.isArray(input.protocolVersions)
            ? input.protocolVersions.filter((version): version is number => typeof version === "number")
            : [];
        const protocolVersion = negotiateVersion(requestedVersions);
        if (!protocolVersion) {
          client.close(1002, "No shared remote protocol version.");
          return;
        }
        clearTimeout(timeout);
        webSocketClients.set(client, protocolVersion);
        client.send(JSON.stringify({ type: "connected", protocolVersion, protocolVersions: supportedProtocolVersions }));
        client.once("close", () => webSocketClients.delete(client));
      });
    });
  });

  await new Promise<void>((resolve, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(options.port ?? 4787, options.host ?? "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to determine gateway address.");

  return {
    url: `http://${address.address.includes(":") ? `[${address.address}]` : address.address}:${address.port}`,
    async close(): Promise<void> {
      for (const client of sseClients.keys()) client.end();
      for (const client of webSocketClients.keys()) client.close(1001, "Gateway stopped.");
      for (const cleanup of cleanups) cleanup();
      await Promise.all([...runtimes].map(async (runtime) => runtime.dispose?.()));
      webSockets.close();
      await new Promise<void>((resolve, rejectClose) => server.close((error) => error ? rejectClose(error) : resolve()));
    }
  };
}
