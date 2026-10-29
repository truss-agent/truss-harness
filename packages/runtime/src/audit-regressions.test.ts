import { once } from "node:events";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentRuntime,
  CompositeContextManager,
  EventBus,
  FileWorkspaceMemoryStore,
  FileWorkspacePlanStore,
  InMemorySessionStore,
  RecentHistoryContextManager,
  ToolRegistry,
  replaceInFileTool,
  writeFileTool,
  type ChatMessage,
  type ModelProvider,
  type ModelStreamEvent,
  type RuntimeEvent,
} from "./index.js";
const roots: string[] = [];
async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "truss-audit-test-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
const task = (id: string) => ({
  id,
  sessionId: id,
  objective: id,
  status: "completed" as const,
  startedAt: "2026-01-01",
  tools: [],
  modifiedFiles: [id],
});
function runtime(
  root: string,
  provider: ModelProvider,
  tools = new ToolRegistry(),
  events = new EventBus<RuntimeEvent>(),
  approval?: { approve(): Promise<boolean> },
) {
  return new AgentRuntime({
    workspaceRoot: root,
    provider,
    tools,
    events,
    approval,
    sessions: new InMemorySessionStore(),
    context: new RecentHistoryContextManager(),
  });
}
describe("audit runtime regressions", () => {
  it("orders create and update transactions invoked on the same plan store", async () => {
    const root = await workspace();
    for (let i = 0; i < 20; i++) {
      const store = new FileWorkspacePlanStore(root, join(root, `plan-${i}`));
      await Promise.all([
        store.create({ title: "plan", objective: "work", steps: ["first"] }),
        store.updateStep("step-1", "completed"),
      ]);
      expect((await store.load())?.status).toBe("completed");
    }
  });

  it("rejects a provider stream without a semantic finish before dispatching buffered tools", async () => {
    const root = await workspace();
    const tools = new ToolRegistry();
    tools.register(writeFileTool);
    const provider: ModelProvider = {
      id: "truncated",
      async *stream(): AsyncIterable<ModelStreamEvent> {
        yield {
          type: "tool_call",
          id: "bad",
          name: "write_file",
          input: { path: "unsafe", content: "partial" },
        };
      },
    };
    const agent = runtime(root, provider, tools);
    const session = await agent.createSession();
    await expect(agent.run(session.id, "work")).rejects.toThrow(
      /incomplete|finish|ended/i,
    );
    await expect(readFile(join(root, "unsafe"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("recovers a storage lock whose owning process was killed", async () => {
    const root = await workspace();
    const worker = fileURLToPath(
      new URL("../test-fixtures/memory-worker.ts", import.meta.url),
    );
    const child = spawn(
      process.execPath,
      ["node_modules/vite-node/vite-node.mjs", worker, root, "hold"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    try {
      await new Promise<void>((resolve, reject) => {
        child.stdout.on("data", (chunk) => {
          if (String(chunk).includes("locked")) resolve();
        });
        child.on("error", reject);
        child.on("exit", (code) => reject(new Error(`Worker exited: ${code}`)));
      });
      const closed = once(child, "close");
      child.kill("SIGKILL");
      await closed;
      const store = new FileWorkspaceMemoryStore(root, {
        path: join(root, "state"),
      });
      await store.upsertTask(task("recovered"));
      expect((await store.load()).tasks[0]?.id).toBe("recovered");
    } finally {
      child.kill("SIGKILL");
    }
  }, 20_000);

  it("preserves concurrent memory updates from separate processes", async () => {
    const root = await workspace();
    const execute = promisify(execFile);
    const worker = fileURLToPath(
      new URL("../test-fixtures/memory-worker.ts", import.meta.url),
    );
    await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        execute(process.execPath, [
          "node_modules/vite-node/vite-node.mjs",
          worker,
          root,
          String(i),
        ]),
      ),
    );
    const memory = await new FileWorkspaceMemoryStore(root).load();
    expect(memory.tasks.map((task) => task.id).sort()).toEqual([
      "0",
      "1",
      "2",
      "3",
    ]);
  }, 15_000);

  it.each(["TARGET", "TAR  GET"])(
    "preserves literal replacement bytes for %s",
    async (old) => {
      const root = await workspace();
      const path = join(root, "file");
      await writeFile(path, "before TAR  GET after");
      const target = old === "TARGET" ? "TAR GET" : old;
      const value = "$& $$ $` $' $1";
      await replaceInFileTool.execute(
        { path: "file", oldText: target, newText: value },
        { workspaceRoot: root },
      );
      expect(await readFile(path, "utf8")).toBe("before $& $$ $` $' $1 after");
    },
  );
  it.each(["requested", "approval", "between", "during"])(
    "propagates cancellation at %s without subsequent writes or completion",
    async (boundary) => {
      const root = await workspace();
      const controller = new AbortController();
      const events = new EventBus<RuntimeEvent>();
      const seen: string[] = [];
      const tools = new ToolRegistry();
      tools.register(writeFileTool);
      tools.register({
        name: "slow",
        description: "slow",
        inputSchema: { type: "object" },
        async execute() {
          controller.abort();
          await Promise.resolve();
          return { content: "settled" };
        },
      });
      events.subscribe((event) => {
        seen.push(event.type);
        if (
          (boundary === "requested" && event.type === "tool_call_requested") ||
          (boundary === "between" && event.type === "tool_completed")
        )
          controller.abort();
      });
      const provider: ModelProvider = {
        id: "test",
        async *stream(): AsyncIterable<ModelStreamEvent> {
          yield {
            type: "tool_call",
            id: "a",
            name: boundary === "during" ? "slow" : "write_file",
            input: { path: "first", content: "one" },
          };
          yield {
            type: "tool_call",
            id: "b",
            name: "write_file",
            input: { path: "second", content: "two" },
          };
          yield { type: "finish", reason: "tool_calls" };
        },
      };
      const agent = runtime(root, provider, tools, events, {
        async approve() {
          if (boundary === "approval") controller.abort();
          return true;
        },
      });
      const session = await agent.createSession();
      await expect(
        agent.run(session.id, "work", controller.signal),
      ).rejects.toMatchObject({ name: "AbortError" });
      await expect(readFile(join(root, "second"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      if (boundary === "requested" || boundary === "approval")
        await expect(readFile(join(root, "first"))).rejects.toMatchObject({
          code: "ENOENT",
        });
      expect(seen).not.toContain("run_completed");
    },
  );
  it.each([false, true])(
    "reports token exhaustion and never executes partial tools (%s)",
    async (toolsPresent) => {
      const root = await workspace();
      const tools = new ToolRegistry();
      tools.register(writeFileTool);
      const events = new EventBus<RuntimeEvent>();
      const seen: RuntimeEvent[] = [];
      events.subscribe((e) => {
        seen.push(e);
      });
      const provider: ModelProvider = {
        id: "test",
        async *stream(): AsyncIterable<ModelStreamEvent> {
          yield { type: "text_delta", text: "unfinished(" };
          if (toolsPresent)
            yield {
              type: "tool_call",
              id: "partial",
              name: "write_file",
              input: { path: "unsafe", content: "partial" },
            };
          yield { type: "finish", reason: "length" };
        },
      };
      const agent = runtime(root, provider, tools, events);
      const session = await agent.createSession();
      await expect(agent.run(session.id, "work")).rejects.toThrow(
        /token|length|incomplete/i,
      );
      expect(seen.map((e) => e.type)).not.toContain("run_completed");
      await expect(readFile(join(root, "unsafe"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );
  it("runs verification again after a state-changing tool", async () => {
    const root = await workspace();
    const tools = new ToolRegistry();
    tools.register(writeFileTool);
    let executions = 0;
    tools.register({
      name: "run_terminal",
      description: "verification",
      inputSchema: { type: "object" },
      async execute() {
        executions++;
        return { content: "passed" };
      },
    });
    let turn = 0;
    const provider: ModelProvider = {
      id: "test",
      async *stream(): AsyncIterable<ModelStreamEvent> {
        const current = turn++;
        if (current < 3) {
          yield {
            type: "tool_call",
            id: String(current),
            name: current === 1 ? "write_file" : "run_terminal",
            input:
              current === 1
                ? { path: "code", content: "changed" }
                : { command: "npm test" },
          };
          yield { type: "finish", reason: "tool_calls" };
        } else {
          yield { type: "text_delta", text: "done" };
          yield { type: "finish", reason: "stop" };
        }
      },
    };
    const agent = runtime(root, provider, tools);
    const session = await agent.createSession();
    await agent.run(session.id, "verify");
    expect(executions).toBe(2);
  });
  it.each([39, 40, 41, 42])(
    "retains complete multi-call exchanges at %i messages",
    async (count) => {
      const messages: ChatMessage[] = [
        { role: "user", content: "start" },
        {
          role: "assistant",
          content: "",
          toolCalls: [
            { id: "a", name: "read", input: {} },
            { id: "b", name: "read", input: {} },
          ],
        },
        { role: "tool", toolCallId: "a", content: "ok" },
        { role: "tool", toolCallId: "b", content: "error" },
        ...Array.from({ length: count - 4 }, () => ({
          role: "user" as const,
          content: "later",
        })),
      ];
      for (const context of [
        new RecentHistoryContextManager(),
        new CompositeContextManager(),
      ]) {
        const selected = await context.build({
          id: "s",
          messages,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        const results = selected.filter((m) => m.role === "tool");
        const calls = selected.flatMap((m) => m.toolCalls ?? []);
        expect(results.map((m) => m.toolCallId)).toEqual(
          calls.map((c) => c.id),
        );
      }
    },
  );
  it("serializes memory across stores without losing tasks or repository state", async () => {
    const root = await workspace();
    const stores = Array.from(
      { length: 4 },
      () => new FileWorkspaceMemoryStore(root),
    );
    await Promise.all([
      ...Array.from({ length: 20 }, (_, i) =>
        stores[i % 4]!.upsertTask(task(String(i))),
      ),
      stores[0]!.updateRepositoryState({
        updatedAt: "today",
        changedFiles: ["code"],
      }),
    ]);
    const state = await stores[0]!.load();
    expect(state.tasks).toHaveLength(20);
    expect(state.repository?.changedFiles).toEqual(["code"]);
    expect(state.recentlyModifiedFiles).toHaveLength(20);
  });
  it("recovers memory queue after a corrupt read and allows clear", async () => {
    const root = await workspace();
    const store = new FileWorkspaceMemoryStore(root, {
      path: join(root, "state"),
    });
    await writeFile(store.path, "bad json");
    await expect(store.upsertTask(task("bad"))).rejects.toThrow();
    await store.clear();
    await store.upsertTask(task("good"));
    expect((await store.load()).tasks[0]?.id).toBe("good");
  });
  it("serializes whole plan transactions across instances", async () => {
    const root = await workspace();
    const a = new FileWorkspacePlanStore(root);
    const b = new FileWorkspacePlanStore(root);
    await a.create({
      title: "plan",
      objective: "work",
      steps: ["first", "second"],
    });
    await Promise.all([
      a.updateStep("step-1", "completed"),
      b.updateStep("step-2", "completed"),
    ]);
    expect((await a.load())?.status).toBe("completed");
  });
  it("recovers plan queue after a failed write", async () => {
    const root = await workspace();
    const path = join(root, "blocked", "plan");
    await writeFile(join(root, "blocked"), "file");
    const store = new FileWorkspacePlanStore(root, path);
    const input = { title: "plan", objective: "work", steps: ["first"] };
    await expect(store.create(input)).rejects.toThrow();
    await rm(join(root, "blocked"));
    await mkdir(join(root, "blocked"));
    await store.create(input);
    expect((await store.load())?.title).toBe("plan");
  });
});
