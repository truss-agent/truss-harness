import { afterEach, describe, expect, it } from "vitest";
import { EventBus, type AgentCoordinatorEvent, type AgentRuntime, type RuntimeEvent } from "@truss-harness/runtime";
import WebSocket from "ws";
import { startRemoteGateway, type GatewayAgentController, type RunningRemoteGateway } from "./index.js";

describe("remote gateway", () => {
  let gateway: RunningRemoteGateway | undefined;

  afterEach(async () => {
    await gateway?.close();
  });

  it("requires a token and accepts a remote chat command", async () => {
    const events = new EventBus<RuntimeEvent>();
    const messages = new Map<string, []>();
    let sessionNumber = 0;
    const runtimeModes: Array<{ readonly mode: string; readonly approvalMode?: string }> = [];
    const runtime = {
      createSession: async (history: [] = []) => {
        const id = `session-${++sessionNumber}`;
        messages.set(id, history);
        return { id };
      },
      getSession: async (id: string) => {
        const history = messages.get(id);
        return history ? { id, messages: history } : undefined;
      },
      run: async (sessionId: string) => {
        await events.emit({ type: "run_started", sessionId });
        await events.emit({ type: "run_completed", sessionId, modifiedFiles: [] });
      }
    } as unknown as AgentRuntime;
    const token = "a-secure-test-token-with-enough-characters";
    gateway = await startRemoteGateway({
      token,
      port: 0,
      workspaces: [{
        id: "workspace",
        displayName: "Test workspace",
        createRuntime: async (mode, approvalMode) => {
          runtimeModes.push({ mode, approvalMode });
          return { runtime: runtime as unknown as AgentRuntime, events };
        }
      }]
    });

    expect((await fetch(`${gateway.url}/v1/commands`, { method: "POST" })).status).toBe(401);
    const created = await fetch(`${gateway.url}/v1/commands`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ version: 1, requestId: "create-1", type: "create_session", workspaceId: "workspace", mode: "chat" })
    });
    expect(await created.json()).toEqual({ requestId: "create-1", type: "session_created", sessionId: "session-1" });
    const wrongVersion = await fetch(`${gateway.url}/v1/commands`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ version: 2, requestId: "wrong-version", type: "send_message", sessionId: "session-1", prompt: "Hello" }),
    });
    expect(await wrongVersion.json()).toMatchObject({ requestId: "wrong-version", type: "rejected", code: "invalid_command" });

    const socket = new WebSocket(`${gateway.url.replace(/^http/, "ws")}/v1/events`);
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.once("open", () => socket.send(JSON.stringify({ type: "authenticate", token })));
      socket.on("message", (payload) => {
        const event = JSON.parse(payload.toString()) as { type: string };
        if (event.type === "connected") resolve();
      });
    });
    const completed = new Promise<void>((resolve) => socket.on("message", (payload) => {
      if ((JSON.parse(payload.toString()) as { type: string }).type === "run_completed") resolve();
    }));

    const sent = await fetch(`${gateway.url}/v1/commands`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ version: 1, requestId: "message-1", type: "send_message", sessionId: "session-1", prompt: "Hello" })
    });
    expect(await sent.json()).toEqual({ requestId: "message-1", type: "accepted" });
    await completed;
    const switched = await fetch(`${gateway.url}/v1/commands`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ version: 1, requestId: "switch-1", type: "change_session_mode", sessionId: "session-1", mode: "edit", toolApprovalMode: "auto-read" })
    });
    expect(await switched.json()).toEqual({ requestId: "switch-1", type: "session_created", sessionId: "session-2" });
    expect(runtimeModes).toEqual([{ mode: "chat", approvalMode: undefined }, { mode: "edit", approvalMode: "auto-read" }]);
    socket.close();
  });

  it("negotiates v2 and scopes managed-agent commands to an enabled workspace", async () => {
    const agentEvents = new EventBus<AgentCoordinatorEvent>();
    const run = {
      id: "run-1",
      agentId: "agent-1",
      state: "queued" as const,
      prompt: "Review files",
      changedFiles: [] as const,
    };
    const agents: GatewayAgentController = {
      access: { canStart: true, canStop: true, canResolveApproval: true },
      events: agentEvents,
      async listProfiles() {
        return [{ id: "agent-1", displayName: "Research", providerId: "ollama", modelId: "qwen", mode: "plan", approvalPolicy: "ask", internetAccess: false }];
      },
      listRuns() { return [run]; },
      async start() {
        await agentEvents.emit({ type: "run_updated", run });
        return run;
      },
      async stop() { return { ...run, state: "cancelled" as const }; },
      async resolveApproval() { return true; },
    };
    const token = "a-secure-test-token-with-enough-characters";
    gateway = await startRemoteGateway({
      token,
      port: 0,
      workspaces: [{
        id: "workspace",
        displayName: "Test workspace",
        agents,
        createRuntime: async () => { throw new Error("not used"); },
      }],
    });

    const listed = await fetch(`${gateway.url}/v1/workspaces`, { headers: { authorization: `Bearer ${token}` } });
    expect(await listed.json()).toMatchObject({ workspaces: [{ id: "workspace", capabilities: { protocolVersions: [1, 2], supportsAgents: true, agentActions: ["start", "stop", "approve"] } }] });

    const socket = new WebSocket(`${gateway.url.replace(/^http/, "ws")}/v1/events`);
    const connected = new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.once("open", () => socket.send(JSON.stringify({ type: "authenticate", token, protocolVersions: [2, 1] })));
      socket.on("message", (payload) => {
        const event = JSON.parse(payload.toString()) as { type: string; protocolVersion?: number };
        if (event.type === "connected") {
          expect(event.protocolVersion).toBe(2);
          resolve();
        }
      });
    });
    await connected;

    const available = await fetch(`${gateway.url}/v1/commands`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ version: 2, requestId: "agents-1", type: "list_agents", workspaceId: "workspace" }),
    });
    expect(await available.json()).toMatchObject({ requestId: "agents-1", type: "agents_listed", profiles: [{ id: "agent-1", providerId: "ollama" }], runs: [{ id: "run-1" }] });

    const updated = new Promise<void>((resolve) => socket.on("message", (payload) => {
      if ((JSON.parse(payload.toString()) as { type: string }).type === "agent_run_updated") resolve();
    }));
    const started = await fetch(`${gateway.url}/v1/commands`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ version: 2, requestId: "start-1", type: "start_agent", workspaceId: "workspace", agentId: "agent-1", prompt: "Review files" }),
    });
    expect(await started.json()).toMatchObject({ requestId: "start-1", type: "agent_run", run: { id: "run-1" } });
    await updated;
    socket.close();
  });

  it("rejects agent actions that the host did not delegate", async () => {
    const agents: GatewayAgentController = {
      access: { canStart: false, canStop: true, canResolveApproval: true },
      events: new EventBus<AgentCoordinatorEvent>(),
      async listProfiles() {
        return [{ id: "agent-1", displayName: "Review", providerId: "ollama", modelId: "qwen", mode: "plan", approvalPolicy: "ask", internetAccess: false }];
      },
      listRuns() { return []; },
      async start() { throw new Error("must not start"); },
      async stop() { throw new Error("not used"); },
      async resolveApproval() { return false; },
    };
    const token = "a-secure-test-token-with-enough-characters";
    gateway = await startRemoteGateway({
      token,
      port: 0,
      workspaces: [{ id: "workspace", displayName: "Test workspace", agents, createRuntime: async () => { throw new Error("not used"); } }],
    });
    const response = await fetch(`${gateway.url}/v1/commands`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ version: 2, requestId: "start-denied", type: "start_agent", workspaceId: "workspace", agentId: "agent-1", prompt: "Review" }),
    });
    expect(await response.json()).toMatchObject({ requestId: "start-denied", type: "rejected", code: "not_authorized" });
  });
});
