import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { AgentRuntime, RemoteCommandResult, RemoteHostCapabilities, RemoteToolApprovalMode, RemoteWorkspace, RuntimeEvent, ToolApproval } from "@truss-harness/runtime";
import { toRemoteSessionEvent } from "@truss-harness/runtime";
export { createPairingUri, detectLanAddress } from "./pairing.js";

export interface GatewayRuntime {
  readonly runtime: AgentRuntime;
  readonly events: { subscribe(listener: (event: RuntimeEvent) => void): () => void };
  readonly approval?: ToolApproval & { resolve?(callId: string, approved: boolean): boolean; denyAll?(): void };
  dispose?(): Promise<void>;
}

/** A host-configured workspace. The root path remains private to the host. */
export interface GatewayWorkspace {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities?: RemoteHostCapabilities;
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
  controller?: AbortController;
}

interface ConfiguredWorkspace {
  readonly remote: RemoteWorkspace;
  readonly createRuntime: GatewayWorkspace["createRuntime"];
}

const defaultCapabilities: RemoteHostCapabilities = {
  modes: ["chat", "plan", "edit"],
  toolApprovalModes: ["ask", "auto-read", "auto-all"],
  supportsAttachments: false,
  supportsDiffs: false,
  supportsToolApproval: true
};

function isApprovalMode(value: unknown): value is RemoteToolApprovalMode {
  return value === "ask" || value === "auto-read" || value === "auto-all";
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
    workspaces.set(workspace.id, {
      remote: { id: workspace.id, displayName: workspace.displayName, capabilities: workspace.capabilities ?? defaultCapabilities },
      createRuntime: workspace.createRuntime
    });
  }

  const sessions = new Map<string, SessionContext>();
  const sseClients = new Set<ServerResponse>();
  const webSocketClients = new Set<WebSocket>();
  const cleanups = new Set<() => void>();
  const runtimes = new Set<GatewayRuntime>();
  let sequence = 0;

  const broadcast = (event: RuntimeEvent): void => {
    const payload = JSON.stringify(toRemoteSessionEvent(event, ++sequence));
    for (const client of sseClients) client.write(`event: remote-session\ndata: ${payload}\n\n`);
    for (const client of webSocketClients) if (client.readyState === WebSocket.OPEN) client.send(payload);
  };

  const authorize = (request: IncomingMessage): boolean => {
    const authorization = request.headers.authorization;
    return authorization?.startsWith("Bearer ") === true && hasToken(authorization.slice("Bearer ".length), options.token);
  };

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
    if (input.version !== 1 || typeof input.type !== "string") return reject(requestId, "invalid_command", "Unsupported remote-session command.");

    if (input.type === "create_session") {
      const workspace = typeof input.workspaceId === "string" ? workspaces.get(input.workspaceId) : undefined;
      if (!workspace || (input.mode !== "chat" && input.mode !== "plan" && input.mode !== "edit") || !workspace.remote.capabilities.modes.includes(input.mode)) {
        return reject(requestId, "not_authorized", "The requested workspace or mode is unavailable.");
      }
      if (input.toolApprovalMode !== undefined && (!isApprovalMode(input.toolApprovalMode) || !workspace.remote.capabilities.toolApprovalModes.includes(input.toolApprovalMode))) {
        return reject(requestId, "not_authorized", "The requested tool approval mode is unavailable.");
      }
      const runtime = await workspace.createRuntime(input.mode, input.toolApprovalMode);
      const session = await runtime.runtime.createSession();
      addRuntime(runtime);
      sessions.set(session.id, { runtime, workspace });
      return { requestId, type: "session_created", sessionId: session.id };
    }

    if (typeof input.sessionId !== "string") return reject(requestId, "invalid_command", "A sessionId is required.");
    const session = sessions.get(input.sessionId);
    if (!session) return reject(requestId, "not_found", "Unknown remote session.");

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
      sessions.set(replacement.id, { runtime, workspace: session.workspace });
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
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" });
      response.write(": connected\n\n");
      sseClients.add(response);
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
        clearTimeout(timeout);
        webSocketClients.add(client);
        client.send(JSON.stringify({ type: "connected" }));
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
      for (const client of sseClients) client.end();
      for (const client of webSocketClients) client.close(1001, "Gateway stopped.");
      for (const cleanup of cleanups) cleanup();
      await Promise.all([...runtimes].map(async (runtime) => runtime.dispose?.()));
      webSockets.close();
      await new Promise<void>((resolve, rejectClose) => server.close((error) => error ? rejectClose(error) : resolve()));
    }
  };
}
