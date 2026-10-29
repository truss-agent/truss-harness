import { expect, it } from "vitest";
import { AgentToolExecutor } from "./tool-executor.js";
import { ToolRegistry } from "../tools.js";
import type { Session } from "../contracts.js";
it("passes the run abort signal to pending approvals", async () => {
  const controller = new AbortController();
  const tools = new ToolRegistry();
  tools.register({
    name: "fixture",
    description: "fixture",
    inputSchema: { type: "object", properties: {} },
    async execute() {
      throw new Error("must not execute");
    },
  });
  let observed: AbortSignal | undefined;
  const executor = new AgentToolExecutor({
    workspaceRoot: process.cwd(),
    tools,
    emit: async () => {},
    approval: {
      async approve(_call, _session, context?: { signal?: AbortSignal }) {
        observed = context?.signal;
        return false;
      },
    },
  });
  await executor.execute(
    { id: "session", messages: [] } as unknown as Session,
    { id: "call", name: "fixture", input: {} },
    controller.signal,
  );
  expect(observed).toBe(controller.signal);
});
