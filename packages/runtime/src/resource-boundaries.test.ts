import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CompositeContextManager,
  RecentHistoryContextManager,
  WorkspaceFileContextProvider,
} from "./context.js";
import { InMemorySessionStore } from "./sessions.js";
import { createTerminalTool, readFileTool, ToolRegistry } from "./tools.js";
import { AgentToolExecutor } from "./agent/tool-executor.js";

const roots: string[] = [];
async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "truss-task3-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
function node(script: string) {
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`;
}

describe("bounded process execution", () => {
  it("caps combined stdout and stderr as bytes while draining the process", async () => {
    const result = await createTerminalTool(2_000, {
      maxOutputBytes: 1024,
    }).execute(
      {
        command: node(
          'process.stdout.write("🙂".repeat(2000)); process.stderr.write("x".repeat(2000))',
        ),
      },
      { workspaceRoot: await workspace() },
    );
    expect(Buffer.byteLength(result.content)).toBeLessThanOrEqual(1024);
    expect(result.content).toContain("truncated");
    expect(result.content).not.toContain("�");
  });

  it.each(["timeout", "abort"])(
    "kills POSIX descendants and bounds drain after %s",
    async (mode) => {
      if (process.platform === "win32") return;
      const root = await workspace();
      const marker = join(root, "descendant-finished");
      const child = `process.on("SIGTERM",()=>{}); setTimeout(()=>require("fs").writeFileSync(${JSON.stringify(marker)},"escaped"),650); setTimeout(()=>{},800)`;
      const script = `require("child_process").spawn(process.execPath,["-e",${JSON.stringify(child)}],{stdio:"inherit"}); setTimeout(()=>{},800)`;
      await writeFile(join(root, "parent.cjs"), script);
      const controller = new AbortController();
      const start = Date.now();
      const promise = createTerminalTool(
        mode === "timeout" ? 150 : 2000,
      ).execute(
        { command: `${JSON.stringify(process.execPath)} parent.cjs` },
        { workspaceRoot: root, signal: controller.signal },
      );
      const abort =
        mode === "abort"
          ? setTimeout(() => controller.abort(), 150)
          : undefined;
      const result = await promise;
      if (abort) clearTimeout(abort);
      expect(Date.now() - start).toBeLessThan(600);
      expect(result.isError).toBe(true);
      expect(result.content).toMatch(
        mode === "timeout" ? /timed out/i : /abort/i,
      );
      await new Promise((resolve) => setTimeout(resolve, 700));
      await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );
});

describe("context and result byte budgets", () => {
  it("bounds built-in file reads before accumulating large files", async () => {
    const root = await workspace();
    await writeFile(join(root, "large.txt"), "🙂".repeat(100_000));
    const result = await readFileTool.execute(
      { path: "large.txt" },
      { workspaceRoot: root },
    );
    expect(Buffer.byteLength(result.content)).toBeLessThanOrEqual(262_144);
    expect(result.content).toContain("truncated");
    expect(result.content).not.toContain("�");
  });

  it("bounds workspace context collection across files", async () => {
    const root = await workspace();
    await writeFile(join(root, "a"), "a".repeat(500_000));
    await writeFile(join(root, "b"), "b".repeat(500_000));
    const blocks = await new WorkspaceFileContextProvider(root, ["a", "b"], {
      maxBytes: 1000,
    }).collect();
    expect(
      blocks.reduce((n, block) => n + Buffer.byteLength(block.content), 0),
    ).toBeLessThanOrEqual(1000);
    expect(blocks[0]?.content).toContain("truncated");
  });

  it.each(["recent", "composite"])(
    "bounds serialized %s model context including tool inputs and attachments",
    async (kind) => {
      const session = await new InMemorySessionStore().create([
        { role: "user", content: "small" },
        {
          role: "assistant",
          content: "",
          toolCalls: [
            { id: "one", name: "echo", input: { value: "x".repeat(10000) } },
          ],
        },
        { role: "tool", toolCallId: "one", content: "ok" },
        {
          role: "user",
          content: "now",
          attachments: [
            {
              id: "large",
              kind: "image",
              mediaType: "image/png",
              name: "a",
              size: 10000,
              data: "x".repeat(10000),
            },
          ],
        },
      ]);
      const manager =
        kind === "recent"
          ? new RecentHistoryContextManager(40, 24000, 1000)
          : new CompositeContextManager([], { maxHistoryBytes: 1000 });
      const messages = await manager.build(session, "system instructions");
      expect(Buffer.byteLength(JSON.stringify(messages))).toBeLessThanOrEqual(
        1000,
      );
      for (const message of messages)
        if (message.role === "tool")
          expect(
            messages.some((candidate) =>
              candidate.toolCalls?.some(
                (call) => call.id === message.toolCallId,
              ),
            ),
          ).toBe(true);
    },
  );

  it("rejects oversized system instructions rather than silently dropping their tail", async () => {
    const session = await new InMemorySessionStore().create();
    await expect(
      new RecentHistoryContextManager(40, 24000, 1000).build(
        session,
        "x".repeat(10000),
      ),
    ).rejects.toThrow(/system.*budget/i);
  });

  it("retains complete tool groups that fit the byte budget", async () => {
    const session = await new InMemorySessionStore().create([
      { role: "assistant", content: "old".repeat(1000) },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "a", name: "read", input: {} },
          { id: "b", name: "read", input: {} },
        ],
      },
      { role: "tool", toolCallId: "a", content: "a" },
      { role: "tool", toolCallId: "b", content: "b" },
    ]);
    const messages = await new RecentHistoryContextManager(
      40,
      24000,
      1000,
    ).build(session);
    expect(messages.map((message) => message.role)).toEqual([
      "assistant",
      "tool",
      "tool",
    ]);
  });

  it("caps plugin results before persistence and completion events", async () => {
    const tools = new ToolRegistry();
    tools.register({
      name: "large",
      description: "test",
      inputSchema: { type: "object" },
      execute: async () => ({ content: "🙂".repeat(1000) }),
    });
    const session = await new InMemorySessionStore().create();
    let completion = "";
    await new AgentToolExecutor({
      tools,
      workspaceRoot: ".",
      maxOutputBytes: 100,
      emit: async (event) => {
        if (event.type === "tool_completed") completion = event.result.content;
      },
    }).execute(session, { id: "a", name: "large", input: {} });
    expect(Buffer.byteLength(completion)).toBeLessThanOrEqual(100);
    expect(completion).toContain("truncated");
    expect(session.messages.at(-1)?.content).toBe(completion);
  });
});
