import { describe, expect, it } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  AgentRuntime,
  CompositeContextManager,
  EventBus,
  FileWorkspaceMemoryStore,
  InMemorySessionStore,
  listDirectoryTool,
  ModelProviderRegistry,
  RecentHistoryContextManager,
  StaticContextProvider,
  ToolRegistry,
  grepTool,
  registerCoreTools,
  registerFilesystemTools,
  searchFilesTool,
  writeFileTool,
  type ModelProvider,
  type RuntimeEvent
} from "./index.js";

describe("AgentRuntime", () => {
  it("streams text, executes a tool, and continues the loop", async () => {
    const provider: ModelProvider = { id: "fake", async *stream(request) {
      if (!request.messages.some(m => m.role === "tool")) { yield { type: "text_delta", text: "I already finished. " } as const; yield { type: "tool_call", id: "1", name: "echo", input: { value: "hello" } } as const; yield { type: "finish", reason: "tool_calls" } as const; }
      else { yield { type: "text_delta", text: "Done." } as const; yield { type: "finish", reason: "stop" } as const; }
    }};
    const tools = new ToolRegistry(); tools.register({ name: "echo", description: "echoes", inputSchema: { type: "object" }, async execute(input) { return { content: String(input.value) }; } });
    const events = new EventBus<RuntimeEvent>(); const seen: string[] = []; const text: string[] = []; events.subscribe(event => { seen.push(event.type); if (event.type === "text_delta") text.push(event.text); });
    const runtime = new AgentRuntime({ provider, tools, sessions: new InMemorySessionStore(), context: new RecentHistoryContextManager(), events, workspaceRoot: process.cwd(), deferTextUntilToolDecision: true });
    const session = await runtime.createSession(); await runtime.run(session.id, "test");
    expect(seen).toEqual(["run_started", "tool_call_requested", "tool_completed", "text_delta", "run_completed"]);
    expect(text).toEqual(["Done."]);
    expect(await runtime.getSession(session.id)).toBe(session);
    expect(await runtime.listSessions()).toHaveLength(1);
  });

  it("rejects an edit-intent run that ends without a successful file write", async () => {
    const provider: ModelProvider = { id: "fake", async *stream() {
      yield { type: "text_delta", text: "Updated README.md." } as const;
      yield { type: "finish", reason: "stop" } as const;
    }};
    const events = new EventBus<RuntimeEvent>();
    const failures: string[] = [];
    events.subscribe((event) => { if (event.type === "run_failed") failures.push(event.error.message); });
    const runtime = new AgentRuntime({
      provider,
      tools: new ToolRegistry(),
      sessions: new InMemorySessionStore(),
      context: new RecentHistoryContextManager(),
      events,
      workspaceRoot: process.cwd(),
      requireWriteForEditIntent: true
    });

    const session = await runtime.createSession();
    await expect(runtime.run(session.id, "Update README.md")).rejects.toThrow("without a successful file write");
    expect(failures).toEqual(["Agent ended without a successful file write. No workspace changes were made."]);
  });

  it("records a denied tool result and continues the model loop", async () => {
    const provider: ModelProvider = { id: "fake", async *stream(request) {
      if (!request.messages.some((message) => message.role === "tool")) {
        yield { type: "tool_call", id: "write-1", name: "write_file", input: { path: "a.txt", content: "no" } } as const;
        yield { type: "finish", reason: "tool_calls" } as const;
      } else {
        expect(request.messages.at(-1)?.content).toBe("Tool call denied: write_file");
        yield { type: "finish", reason: "stop" } as const;
      }
    }};
    const tools = new ToolRegistry();
    tools.register({ name: "write_file", description: "writes", inputSchema: { type: "object" }, async execute() { throw new Error("must not run"); } });
    const runtime = new AgentRuntime({
      provider,
      tools,
      sessions: new InMemorySessionStore(),
      context: new RecentHistoryContextManager(),
      events: new EventBus<RuntimeEvent>(),
      workspaceRoot: process.cwd(),
      approval: { approve: async () => false }
    });

    const session = await runtime.createSession();
    await runtime.run(session.id, "try to write");
  });

  it("reports only successful filesystem writes as verified changes", async () => {
    const provider: ModelProvider = { id: "fake", async *stream(request) {
      if (!request.messages.some((message) => message.role === "tool")) {
        yield { type: "tool_call", id: "replace-1", name: "replace_in_file", input: { path: "README.md", oldText: "before", newText: "after" } } as const;
        yield { type: "finish", reason: "tool_calls" } as const;
      } else {
        yield { type: "text_delta", text: "Done." } as const;
        yield { type: "finish", reason: "stop" } as const;
      }
    }};
    const tools = new ToolRegistry();
    tools.register({ name: "replace_in_file", description: "replaces", inputSchema: { type: "object" }, async execute() { return { content: "File updated." }; } });
    const events = new EventBus<RuntimeEvent>();
    let completed: Extract<RuntimeEvent, { type: "run_completed" }> | undefined;
    events.subscribe((event) => { if (event.type === "run_completed") completed = event; });
    const runtime = new AgentRuntime({ provider, tools, sessions: new InMemorySessionStore(), context: new RecentHistoryContextManager(), events, workspaceRoot: process.cwd() });

    const session = await runtime.createSession();
    await runtime.run(session.id, "update README");

    expect(completed?.modifiedFiles).toEqual(["README.md"]);
  });

  it("blocks repeated writes until the changed file is read again", async () => {
    const provider: ModelProvider = { id: "fake", async *stream(request) {
      const toolResults = request.messages.filter((message) => message.role === "tool");
      if (!toolResults.length) {
        yield { type: "tool_call", id: "write-1", name: "write_file", input: { path: "README.md", content: "hello" } } as const;
        yield { type: "finish", reason: "tool_calls" } as const;
      } else if (toolResults.length === 1) {
        yield { type: "tool_call", id: "write-2", name: "write_file", input: { path: "README.md", content: "hello\nhello" } } as const;
        yield { type: "finish", reason: "tool_calls" } as const;
      } else {
        expect(toolResults.at(-1)?.content).toContain("Repeated write blocked");
        yield { type: "text_delta", text: "The first write is complete." } as const;
        yield { type: "finish", reason: "stop" } as const;
      }
    }};
    let writes = 0;
    const tools = new ToolRegistry();
    tools.register({ name: "write_file", description: "writes", inputSchema: { type: "object" }, async execute() { writes += 1; return { content: "File written." }; } });
    const runtime = new AgentRuntime({ provider, tools, sessions: new InMemorySessionStore(), context: new RecentHistoryContextManager(), events: new EventBus<RuntimeEvent>(), workspaceRoot: process.cwd() });

    const session = await runtime.createSession();
    await runtime.run(session.id, "Add hello to README");

    expect(writes).toBe(1);
  });

  it("does not execute the same successful terminal command twice in one run", async () => {
    let turn = 0;
    let executions = 0;
    const provider: ModelProvider = { id: "fake", async *stream(request) {
      if (turn++ < 2) {
        yield { type: "tool_call", id: `terminal-${turn}`, name: "run_terminal", input: { command: "npm test" } } as const;
        yield { type: "finish", reason: "tool_calls" } as const;
      } else {
        expect(request.messages.at(-1)?.content).toContain("already completed successfully");
        yield { type: "text_delta", text: "The command already ran." } as const;
        yield { type: "finish", reason: "stop" } as const;
      }
    }};
    const tools = new ToolRegistry();
    tools.register({ name: "run_terminal", description: "runs", inputSchema: { type: "object" }, async execute() { executions += 1; return { content: "Tests passed." }; } });
    const runtime = new AgentRuntime({ provider, tools, sessions: new InMemorySessionStore(), context: new RecentHistoryContextManager(), events: new EventBus<RuntimeEvent>(), workspaceRoot: process.cwd() });

    const session = await runtime.createSession();
    await runtime.run(session.id, "run the tests");

    expect(executions).toBe(1);
  });

  it("returns tool execution errors to the model so it can recover", async () => {
    const provider: ModelProvider = { id: "fake", async *stream(request) {
      if (!request.messages.some((message) => message.role === "tool")) {
        yield { type: "tool_call", id: "read-1", name: "read_file", input: { path: "C:\\outside\\README.md" } } as const;
        yield { type: "finish", reason: "tool_calls" } as const;
      } else {
        expect(request.messages.at(-1)?.content).toContain("Absolute paths are not allowed");
        yield { type: "text_delta", text: "I will use README.md instead." } as const;
        yield { type: "finish", reason: "stop" } as const;
      }
    }};
    const tools = new ToolRegistry();
    tools.register({ name: "read_file", description: "reads", inputSchema: { type: "object" }, async execute() { throw new Error("Absolute paths are not allowed"); } });
    const runtime = new AgentRuntime({
      provider,
      tools,
      sessions: new InMemorySessionStore(),
      context: new RecentHistoryContextManager(),
      events: new EventBus<RuntimeEvent>(),
      workspaceRoot: process.cwd()
    });

    const session = await runtime.createSession();
    await expect(runtime.run(session.id, "summarize the README")).resolves.toBeUndefined();
  });

  it("persists completed task state for future workspace context", async () => {
    const workspaceRoot = join(process.cwd(), ".test-workspaces", randomUUID());
    await mkdir(workspaceRoot, { recursive: true });
    const memory = new FileWorkspaceMemoryStore(workspaceRoot);
    const provider: ModelProvider = { id: "fake", async *stream() {
      yield { type: "text_delta", text: "Implemented the requested change." } as const;
      yield { type: "finish", reason: "stop" } as const;
    }};
    const runtime = new AgentRuntime({
      provider,
      tools: new ToolRegistry(),
      sessions: new InMemorySessionStore(),
      context: new RecentHistoryContextManager(),
      events: new EventBus<RuntimeEvent>(),
      workspaceRoot,
      memory
    });
    try {
      const session = await runtime.createSession();
      await runtime.run(session.id, "Implement durable workspace memory");
      const snapshot = await memory.load();
      expect(snapshot.tasks).toHaveLength(1);
      expect(snapshot.tasks[0]).toMatchObject({ objective: "Implement durable workspace memory", status: "completed" });
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});

describe("ModelProviderRegistry", () => {
  it("tracks registered providers and default selection", () => {
    const first: ModelProvider = { id: "local", async *stream() {} };
    const second: ModelProvider = { id: "cloud", async *stream() {} };
    const registry = new ModelProviderRegistry();

    registry.register(first);
    registry.register(second, { default: true });

    expect(registry.default()).toBe(second);
    expect(registry.get("local")).toBe(first);
    expect(registry.list().map((provider) => provider.id)).toEqual(["local", "cloud"]);
    expect(() => registry.register(first)).toThrow("Model provider already registered");
  });
});

describe("SessionStore", () => {
  it("creates, lists, saves, and restores checkpointed sessions", async () => {
    const store = new InMemorySessionStore();
    const session = await store.create([{ role: "user", content: "hello" }]);

    session.checkpoint = { messages: [...session.messages], createdAt: new Date() };
    session.messages.push({ role: "assistant", content: "temporary" });
    await store.save(session);

    expect(await store.list()).toHaveLength(1);
    await store.restoreCheckpoint(session.id);

    expect((await store.get(session.id))?.messages).toEqual([{ role: "user", content: "hello" }]);
    expect(await store.delete(session.id)).toBe(true);
  });
});

describe("ContextManager", () => {
  it("combines bounded history with prioritized external context", async () => {
    const session = await new InMemorySessionStore().create([
      { role: "user", content: "old" },
      { role: "assistant", content: "new" }
    ]);
    const context = new CompositeContextManager(
      [new StaticContextProvider([{ source: "open-file", content: "export const value = 1;", priority: 10 }])],
      { maxMessages: 1 }
    );

    const messages = await context.build(session, "system instructions", [
      { source: "active-file:src/current.ts", content: "export const current = true;", priority: 1_000 }
    ]);

    expect(messages).toEqual([
      { role: "system", content: 'system instructions\n\nWorkspace context:\n<context source="active-file:src/current.ts">\nexport const current = true;\n</context>\n\n<context source="open-file">\nexport const value = 1;\n</context>' },
      { role: "assistant", content: "new" }
    ]);
  });

  it("keeps per-run context out of persisted conversation history", async () => {
    let modelMessages: readonly { readonly role: string; readonly content: string }[] = [];
    const provider: ModelProvider = { id: "fake", async *stream(request) {
      modelMessages = request.messages;
      yield { type: "finish", reason: "stop" } as const;
    }};
    const sessions = new InMemorySessionStore();
    const runtime = new AgentRuntime({
      provider,
      tools: new ToolRegistry(),
      sessions,
      context: new CompositeContextManager(),
      events: new EventBus<RuntimeEvent>(),
      workspaceRoot: process.cwd()
    });
    const session = await runtime.createSession();

    await runtime.run(session.id, "Explain this file", undefined, [
      { source: "active-file:src/current.ts", content: "const privateContext = true;", priority: 1_000 }
    ]);

    expect(modelMessages[0]?.content).toContain("active-file:src/current.ts");
    expect(modelMessages[0]?.content).toContain("const privateContext = true;");
    expect((await sessions.get(session.id))?.messages[0]).toEqual({ role: "user", content: "Explain this file" });
    expect((await sessions.get(session.id))?.messages.some((message) => message.content.includes("privateContext"))).toBe(false);
  });
});

describe("filesystem tools", () => {
  it("lists the workspace root when path is omitted", async () => {
    const workspaceRoot = join(process.cwd(), ".test-workspaces", randomUUID());
    await mkdir(workspaceRoot, { recursive: true });
    await writeFile(join(workspaceRoot, "README.md"), "workspace", "utf8");

    try {
      const result = await listDirectoryTool.execute({}, { workspaceRoot });
      expect(result.content).toContain("file\tREADME.md");
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("writes nested files and searches workspace content", async () => {
    const workspaceRoot = join(process.cwd(), ".test-workspaces", randomUUID());
    await mkdir(workspaceRoot, { recursive: true });

    try {
      await writeFileTool.execute({ path: "src/notes.txt", content: "needle\nsecond line" }, { workspaceRoot });
      await writeFile(join(workspaceRoot, "src", "other.ts"), "export const other = true;", "utf8");

      const fileMatches = await searchFilesTool.execute({ query: "notes" }, { workspaceRoot });
      const contentMatches = await grepTool.execute({ query: "needle", path: "src" }, { workspaceRoot });

      expect(fileMatches.content).toContain("notes.txt");
      expect(contentMatches.content).toContain("notes.txt:1:1: needle");
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("registers the default filesystem tool bundle", () => {
    const registry = new ToolRegistry();
    registerFilesystemTools(registry);

    expect(registry.definitions().map((definition) => definition.name)).toEqual([
      "read_file",
      "write_file",
      "replace_in_file",
      "list_directory",
      "search_files",
      "grep"
    ]);
  });

  it("registers the core tool bundle", () => {
    const registry = new ToolRegistry();
    registerCoreTools(registry);

    expect(registry.get("run_terminal")).toBeDefined();
    expect(registry.get("read_file")).toBeDefined();
  });
});
