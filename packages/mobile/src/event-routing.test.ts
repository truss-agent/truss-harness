import { expect, it } from "vitest";
import { routeMobileEvent } from "./event-routing.js";
it("ignores interleaved foreign sessions and preserves approval ownership", () => {
  const effects: unknown[] = [];
  const input = {
    workspaceId: "workspace",
    sessionId: "active",
    mode: "chat" as const,
    approvalMode: "ask" as const,
    readOnlyTools: new Set<string>(),
    appendAssistant: (v: string) => effects.push(v),
    appendSystem: (v: string) => effects.push(v),
    updateAgentRun: () => {},
    setStatus: (v: string) => effects.push(v),
    setRunning: (v: boolean) => effects.push(v),
    setApproval: (v: unknown) => effects.push(v),
    setAgentApproval: (v: unknown) => effects.push(v),
  };
  for (const type of [
    "text_delta",
    "run_completed",
    "run_failed",
    "tool_call_requested",
  ])
    routeMobileEvent(
      {
        type,
        sessionId: "other",
        workspaceId: "workspace",
        text: "foreign",
        callId: "foreign",
        tool: "write_file",
        input: {},
      },
      input,
    );
  expect(effects).toEqual([]);
  routeMobileEvent(
    {
      type: "tool_call_requested",
      sessionId: "active",
      workspaceId: "workspace",
      callId: "own",
      tool: "write_file",
      input: {},
    },
    input,
  );
  expect(effects).toContainEqual({
    sessionId: "active",
    workspaceId: "workspace",
    callId: "own",
    tool: "write_file",
    input: {},
  });
  effects.length = 0;
  routeMobileEvent(
    { type: "run_completed", sessionId: "active", workspaceId: "workspace" },
    input,
  );
  expect(effects).toContain(undefined);
  expect(effects).toContain(false);
  effects.length = 0;
  routeMobileEvent(
    {
      type: "text_delta",
      sessionId: "active",
      workspaceId: "old",
      text: "wrong workspace",
    },
    input,
  );
  expect(effects).toEqual([]);
});
it("keeps the workspace that owns a managed-agent approval", () => {
  let approval: unknown;
  routeMobileEvent(
    {
      type: "agent_runtime",
      workspaceId: "workspace",
      runId: "run",
      event: {
        type: "tool_call_requested",
        callId: "call",
        tool: "write_file",
        input: {},
      },
    },
    {
      workspaceId: "workspace",
      mode: "chat",
      approvalMode: "ask",
      readOnlyTools: new Set(),
      appendAssistant() {},
      appendSystem() {},
      updateAgentRun() {},
      setStatus() {},
      setRunning() {},
      setApproval() {},
      setAgentApproval: (value) => {
        approval = value;
      },
    },
  );
  expect(approval).toEqual({
    workspaceId: "workspace",
    runId: "run",
    callId: "call",
    tool: "write_file",
    input: {},
  });
});
