import { afterEach, describe, expect, it } from "vitest";
import { EventBus, type AgentRuntime, type RuntimeEvent } from "@truss-harness/runtime";
import WebSocket from "ws";
import { startRemoteGateway, type RunningRemoteGateway } from "./index.js";

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
});
