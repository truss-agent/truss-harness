import { describe, expect, it, vi } from "vitest";
import type { RuntimeEvent, Session } from "../contracts.js";
import { ToolRegistry } from "../tools.js";
import { AgentToolExecutor } from "./tool-executor.js";

function session(): Session {
  const timestamp = new Date();
  return {
    id: "session-1",
    createdAt: timestamp,
    updatedAt: timestamp,
    messages: [],
  };
}

describe("AgentToolExecutor", () => {
  it("executes an approved tool and records correlated events and history", async () => {
    const tools = new ToolRegistry();
    tools.register({
      name: "echo",
      description: "Echo text",
      inputSchema: { type: "object" },
      execute: async (input) => ({ content: String(input.value) }),
    });
    const events: RuntimeEvent[] = [];
    const executor = new AgentToolExecutor({
      tools,
      workspaceRoot: "/workspace",
      emit: async (event) => {
        events.push(event);
      },
    });
    const activeSession = session();

    const result = await executor.execute(activeSession, {
      id: "call-1",
      name: "echo",
      input: { value: "hello" },
    });

    expect(result).toEqual({
      name: "echo",
      succeeded: true,
      recoveryRequired: false,
    });
    expect(activeSession.messages.at(-1)).toMatchObject({
      role: "tool",
      toolCallId: "call-1",
      content: "hello",
    });
    expect(events.map((event) => event.type)).toEqual([
      "tool_call_requested",
      "tool_completed",
    ]);
  });

  it("does not execute a denied tool", async () => {
    const execute = vi.fn(async () => ({ content: "unexpected" }));
    const tools = new ToolRegistry();
    tools.register({
      name: "write_file",
      description: "Write a file",
      inputSchema: { type: "object" },
      execute,
    });
    const executor = new AgentToolExecutor({
      tools,
      workspaceRoot: "/workspace",
      approval: { approve: async () => false },
      emit: async () => undefined,
    });

    const result = await executor.execute(session(), {
      id: "call-1",
      name: "write_file",
      input: { path: "README.md", content: "test" },
    });

    expect(execute).not.toHaveBeenCalled();
    expect(result).toMatchObject({ name: "write_file", succeeded: false });
  });
});
