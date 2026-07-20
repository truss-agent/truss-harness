import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { AgentRuntime, RemoteCommandResult, RemoteHostCapabilities, RemoteWorkspace, RuntimeEvent, ToolApproval } from "@truss-harness/runtime";
import { toRemoteSessionEvent } from "@truss-harness/runtime";

export interface GatewayRuntime {
  readonly runtime: AgentRuntime;
  readonly events: { subscribe(listener: (event: RuntimeEvent) => void): () => void };
  readonly approval?: ToolApproval & { resolve?(callId: string, approved: boolean): boolean; denyAll?(): void };
  dispose?(): Promise<void>;
}

export interface RemoteGatewayOptions {
  /** A high-entropy token configured by the workspace host. Do not expose this server publicly without TLS and pairing. */
  readonly token: string;
  readonly workspace: Omit<RemoteWorkspace, "capabilities"> & { readonly capabilities?: RemoteHostCapabilities };
  readonly createRuntime: (mode: "chat" | "plan" | "edit") => Promise<GatewayRuntime>;
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
  controller?: AbortController;
}

const defaultCapabilities: RemoteHostCapabilities = {
  modes: ["chat", "plan", "edit"],
  supportsAttachments: false,
  supportsDiffs: false,
  supportsToolApproval: true
};

/**
 * Starts a deliberately small HTTP/SSE adapter for the remote-session contract.
 * It is intended for loopback development or a user-managed secure tunnel; it
 * does not claim to provide internet-facing device pairing or TLS termination.
 */
export async function startRemoteGateway(options: RemoteGatewayOptions): Promise<RunningRemoteGateway> {
  if (options.token.length < 24) throw new Error("Gateway token must contain at least 24 characters.");
  const workspace: RemoteWorkspace = { ...options.workspace, capabilities: options.workspace.capabilities ?? defaultCapabilities };
  const sessions = new Map<string, SessionContext>();
  const clients = new Set<ServerResponse>();
  const cleanups = new Set<() => void>();
  const runtimes = new Set<GatewayRuntime>();
  let sequence = 0;

  const broadcast = (event: RuntimeEvent): void => {
    const payload = JSON.stringify(toRemoteSessionEvent(event, ++sequence));
    for (const client of clients) client.write(`event: remote-session\ndata: ${payload}\n\n`);
  };

  const authorize = (request: IncomingMessage): boolean => {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) return false;
    const candidate = Buffer.from(authorization.slice("Bearer ".length));
    const expected = Buffer.from(options.token);
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  };

  const reply = (response: ServerResponse, status: number, body: unknown): void => {
    response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    response.end(`${JSON.stringify(body)}\n`);
  };

  const reject = (requestId: string, code: Extract<RemoteCommandResult, { type: "rejected" }>["code"], message: string): RemoteCommandResult => ({ requestId, type: "rejected", code, message });

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
      if (typeof input.workspaceId !== "string" || input.workspaceId !== workspace.id || (input.mode !== "chat" && input.mode !== "plan" && input.mode !== "edit") || !workspace.capabilities.modes.includes(input.mode)) {
        return reject(requestId, "not_authorized", "The requested workspace or mode is unavailable.");
      }
      const runtime = await options.createRuntime(input.mode);
      const session = await runtime.runtime.createSession();
      if (!runtimes.has(runtime)) {
        runtimes.add(runtime);
        cleanups.add(runtime.events.subscribe(broadcast));
      }
      sessions.set(session.id, { runtime });
      return { requestId, type: "session_created", sessionId: session.id };
    }

    if (typeof input.sessionId !== "string") return reject(requestId, "invalid_command", "A sessionId is required.");
    const session = sessions.get(input.sessionId);
    if (!session) return reject(requestId, "not_found", "Unknown remote session.");

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
    if (request.method === "GET" && url.pathname === "/health") return reply(response, 200, { ok: true, workspace: { id: workspace.id, displayName: workspace.displayName, capabilities: workspace.capabilities } });
    if (!authorize(request)) return reply(response, 401, { error: "Unauthorized" });

    if (request.method === "GET" && url.pathname === "/v1/events") {
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" });
      response.write(": connected\n\n");
      clients.add(response);
      request.on("close", () => clients.delete(response));
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
      for (const client of clients) client.end();
      for (const cleanup of cleanups) cleanup();
      await Promise.all([...runtimes].map(async (runtime) => runtime.dispose?.()));
      await new Promise<void>((resolve, rejectClose) => server.close((error) => error ? rejectClose(error) : resolve()));
    }
  };
}
