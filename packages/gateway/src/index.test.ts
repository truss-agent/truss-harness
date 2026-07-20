import { afterEach, describe, expect, it } from "vitest";
import { EventBus, type AgentRuntime, type RuntimeEvent } from "@truss-harness/runtime";
import { startRemoteGateway, type RunningRemoteGateway } from "./index.js";

describe("remote gateway", () => {
  let gateway: RunningRemoteGateway | undefined;

  afterEach(async () => {
    await gateway?.close();
  });

  it("requires a token and accepts a remote chat command", async () => {
    const events = new EventBus<RuntimeEvent>();
    const runtime = {
      createSession: async () => ({ id: "session-1" }),
      run: async (sessionId: string) => {
        await events.emit({ type: "run_started", sessionId });
        await events.emit({ type: "run_completed", sessionId, modifiedFiles: [] });
      }
    } as unknown as AgentRuntime;
    const token = "a-secure-test-token-with-enough-characters";
    gateway = await startRemoteGateway({
      token,
      port: 0,
      workspace: { id: "workspace", displayName: "Test workspace" },
      createRuntime: async () => ({ runtime, events })
    });

    expect((await fetch(`${gateway.url}/v1/commands`, { method: "POST" })).status).toBe(401);
    const created = await fetch(`${gateway.url}/v1/commands`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ version: 1, requestId: "create-1", type: "create_session", workspaceId: "workspace", mode: "chat" })
    });
    expect(await created.json()).toEqual({ requestId: "create-1", type: "session_created", sessionId: "session-1" });

    const sent = await fetch(`${gateway.url}/v1/commands`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ version: 1, requestId: "message-1", type: "send_message", sessionId: "session-1", prompt: "Hello" })
    });
    expect(await sent.json()).toEqual({ requestId: "message-1", type: "accepted" });
  });
});
