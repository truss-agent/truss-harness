import { createInterface } from "node:readline/promises";
import { PassThrough } from "node:stream";
import { expect, it } from "vitest";
import type { Session, ToolCall } from "@truss-harness/runtime";
import { CliToolApproval } from "./cli-approval.js";
const call: ToolCall = {
  id: "write",
  name: "write_file",
  input: { path: "file", content: "x".repeat(8000) },
};
const session = { id: "session", messages: [] } as unknown as Session;
it("uses one readline owner for bounded approval previews and normal chat input", async () => {
  const input = new PassThrough(),
    output = new PassThrough();
  let preview = "";
  output.on("data", (data) => {
    preview += data;
  });
  const readline = createInterface({ input, output });
  try {
    const approval = new CliToolApproval("ask", readline);
    const pending = approval.approve(call, session);
    input.write("yes\n");
    expect(await pending).toBe(true);
    expect(preview.length).toBeLessThan(4200);
    expect(preview).toContain("preview truncated");
    const chat = readline.question("next chat: ");
    input.write("hello\n");
    expect(await chat).toBe("hello");
  } finally {
    readline.close();
  }
});
it.each(["signal", "denyAll"])(
  "cancels pending CLI approvals via %s without leaving stdin blocked",
  async (kind) => {
    const input = new PassThrough(),
      output = new PassThrough();
    const readline = createInterface({ input, output });
    const approval = new CliToolApproval("ask", readline);
    const controller = new AbortController();
    try {
      const pending = approval.approve(call, session, {
        signal: controller.signal,
      });
      const rejected = expect(pending).rejects.toThrow(/abort|cancel/i);
      if (kind === "signal") controller.abort();
      else approval.denyAll();
      await rejected;
      const chat = readline.question("next chat: ");
      input.write("still works\n");
      expect(await chat).toBe("still works");
    } finally {
      readline.close();
    }
  },
);
it("auto-read permits only known workspace reads and ask without stdin fails promptly", async () => {
  const approval = new CliToolApproval("auto-read");
  expect(await approval.approve({ ...call, name: "read_file" }, session)).toBe(
    true,
  );
  await expect(approval.approve(call, session)).rejects.toThrow(
    /non-interactive/,
  );
  await expect(
    new CliToolApproval("ask").approve({ ...call, name: "read_file" }, session),
  ).rejects.toThrow(/TTY/);
  expect(await new CliToolApproval("auto-all").approve(call, session)).toBe(
    true,
  );
});

it("Stop aborts a real runtime while its CLI approval is pending and prevents execution", async () => {
  const {
    AgentRuntime,
    ToolRegistry,
    InMemorySessionStore,
    RecentHistoryContextManager,
    EventBus,
  } = await import("@truss-harness/runtime");
  const input = new PassThrough(),
    output = new PassThrough();
  const readline = createInterface({ input, output });
  const controller = new AbortController();
  const tools = new ToolRegistry();
  let executions = 0;
  tools.register({
    name: "fixture",
    description: "fixture",
    inputSchema: { type: "object" },
    async execute() {
      executions++;
      return { content: "executed" };
    },
  });
  const runtime = new AgentRuntime({
    workspaceRoot: process.cwd(),
    tools,
    sessions: new InMemorySessionStore(),
    context: new RecentHistoryContextManager(),
    events: new EventBus(),
    approval: new CliToolApproval("ask", readline),
    provider: {
      id: "fixture",
      async *stream() {
        yield { type: "tool_call", id: "pending", name: "fixture", input: {} };
        yield { type: "finish", reason: "tool_calls" };
      },
    },
  });
  const current = await runtime.createSession();
  const requested = new Promise<void>((resolve) =>
    output.on("data", (data) => {
      if (String(data).includes("Allow once")) resolve();
    }),
  );
  try {
    const run = runtime.run(current.id, "fixture", controller.signal);
    const rejected = expect(run).rejects.toThrow(/abort/i);
    await requested;
    controller.abort();
    await rejected;
    expect(executions).toBe(0);
  } finally {
    readline.close();
  }
});
