import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ child: undefined as unknown }));
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  spawn: () => fake.child,
}));
import { RuntimeService } from "./runtime-service.js";
function fixture(textOnly = true, capabilities: Record<string, boolean> = {}) {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  fake.child = child;
  const sent: Record<string, unknown>[] = [];
  child.stdin.on("data", (data) => sent.push(JSON.parse(String(data))));
  const service = new RuntimeService(
    "fixture",
    [],
    process.cwd(),
    {},
    () => {},
    () => {},
  );
  const send = (message: unknown) =>
    child.stdout.write(JSON.stringify(message) + "\n");
  send({
    type: "response",
    requestId: "vscode-1",
    result: {
      protocolVersion: 1,
      server: {
        name: "truss-cli",
        version: "test",
        identity: {
          runtime: { packageName: "@truss-harness/runtime", version: "0.1.0" },
          protocolVersions: [1],
        },
      },
      capabilities: { textOnlyGeneration: textOnly, ...capabilities },
    },
  });
  return { service, child, sent, send };
}
it.each([true, false])(
  "does not consume the run reply on an approval notification (%s)",
  async (approved) => {
    const h = fixture();
    await h.service.waitUntilReady();
    const run = h.service.run("chat");
    await Promise.resolve();
    h.send({
      type: "event",
      requestId: run.requestId,
      event: { type: "tool_call_requested", sessionId: "session" },
    });
    h.send({
      type: "approval_request",
      requestId: run.requestId,
      sessionId: "session",
      callId: "call",
      tool: "read_file",
      input: {},
    });
    h.service.approve(run.requestId, "call", approved);
    h.send({ type: "lifecycle", requestId: run.requestId, state: "completed" });
    h.send({
      type: "response",
      requestId: run.requestId,
      result: { sessionId: "session" },
    });
    const state = await Promise.race([
      run.result.then(() => "settled"),
      new Promise((r) => setTimeout(() => r("pending"), 20)),
    ]);
    expect(state).toBe("settled");
    h.service.dispose();
  },
);
it("rejects requests after host exit and spawn/write errors", async () => {
  const h = fixture();
  await h.service.waitUntilReady();
  h.child.emit("exit", 1);
  const state = await Promise.race([
    h.service.createSession([]).then(
      () => "resolved",
      () => "rejected",
    ),
    new Promise((r) => setTimeout(() => r("pending"), 20)),
  ]);
  expect(state).toBe("rejected");
  h.service.dispose();
});
it("requires host capability before sending a text-only helper", async () => {
  const h = fixture(false);
  await h.service.waitUntilReady();
  await expect(h.service.generateText("complete").result).rejects.toThrow(
    /text.only/i,
  );
  expect(h.sent.some((m) => m.type === "run")).toBe(false);
  h.service.dispose();
});
it("sends the negotiated text-only flag", async () => {
  const h = fixture();
  await h.service.waitUntilReady();
  const run = h.service.generateText("complete");
  await Promise.resolve();
  expect(h.sent).toContainEqual({
    type: "run",
    prompt: "complete",
    textOnly: true,
    requestId: run.requestId,
  });
  h.send({ type: "response", requestId: run.requestId, result: {} });
  await run.result;
  h.service.dispose();
});
it("gates skill requests on the negotiated capabilities", async () => {
  const old = fixture();
  await expect(old.service.listSkills()).rejects.toThrow(
    /does not support skills/,
  );
  expect(old.sent.some((m) => String(m.type).startsWith("skills_"))).toBe(
    false,
  );
  old.service.dispose();

  const h = fixture(true, { skills: true });
  const selection = { mode: "off", superpowersEnabled: true, skillIds: [] };
  const updated = h.service.updateSkillSettings("workspace", { mode: "off" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const request = h.sent.find((m) => m.type === "skills_settings");
  expect(request).toMatchObject({
    scope: "workspace",
    selection: { mode: "off" },
  });
  h.send({
    type: "response",
    requestId: request?.requestId,
    result: { skills: { skills: [], diagnostics: [], selection } },
  });
  expect((await updated).selection).toEqual(selection);
  await expect(h.service.importSkill("/skills/notes")).rejects.toThrow(
    /does not support skills/,
  );
  h.service.dispose();
});
