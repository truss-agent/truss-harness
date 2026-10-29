import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentProviderRegistry,
  createDefaultSkills,
} from "@truss-harness/agent-host";
import type { ModelRequest, ModelStreamEvent } from "@truss-harness/runtime";
import { afterEach, expect, it, vi } from "vitest";
import type { ResolvedConfiguration } from "../config.js";
import { createClientRuntime } from "../runtime.js";
import { InteractiveChat } from "./controller.js";
import { FileConversationStore, unknownOutcome } from "./conversations.js";
import { createStyle } from "./renderer.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

type Turn = (request: ModelRequest) => AsyncIterable<ModelStreamEvent>;

async function harness(
  turns: Turn[],
  permission: "ask" | "auto-all" = "ask",
  mode: "chat" | "edit" = "edit",
) {
  const base = await mkdtemp(join(tmpdir(), "truss-interactive-"));
  roots.push(base);
  const requests: ModelRequest[] = [];
  const providers = new AgentProviderRegistry();
  providers.register({
    descriptor: {
      id: "openai-compatible",
      label: "Fixture",
      requiresCredential: false,
    },
    async validate() {},
    async create() {
      return {
        id: "fixture",
        stream(request: ModelRequest) {
          requests.push(request);
          const turn = turns.shift();
          if (!turn) throw new Error("No scripted turn left.");
          return turn(request);
        },
      };
    },
  });
  const configuration = {
    workspaceRoot: base,
    provider: "openai-compatible",
    baseUrl: "http://fixture.invalid",
    model: "fixture",
    mode,
    permission,
    providerRegistry: providers,
    skills: createDefaultSkills({
      workspaceRoot: base,
      userConfigDirectory: join(base, "config"),
    }),
    paths: { user: join(base, "config", "config.json"), workspace: "" },
  } as unknown as ResolvedConfiguration;
  let output = "";
  let now = 0;
  const conversations = new FileConversationStore(join(base, "saved"), base);
  const chat = new InteractiveChat({
    configuration,
    workspaceRoot: base,
    write: (text) => {
      output += text;
    },
    columns: () => 80,
    style: createStyle(false),
    createRuntime: createClientRuntime,
    conversations,
    now: () => now,
  });
  await chat.start();
  const plain = () =>
    // biome-ignore lint/suspicious/noControlCharactersInRegex: strip cursor movement from captured output
    output.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "");
  return {
    base,
    chat,
    requests,
    conversations,
    plain,
    type: (text: string) => chat.handleData(text),
    tick: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

const finish: ModelStreamEvent = { type: "finish", reason: "stop" };

it("streams a reply while keeping the draft being typed", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const test = await harness(
    [
      async function* () {
        yield { type: "text_delta", text: "Hello **there**\nsecond" };
        await gate;
        yield { type: "text_delta", text: " line\n" };
        yield finish;
      },
    ],
    "ask",
    "chat",
  );
  test.type("hi\r");
  await vi.waitFor(() => expect(test.plain()).toContain("Hello there"));
  test.type("next idea");
  test.type("\r");
  await vi.waitFor(() =>
    expect(test.plain()).toContain("A response is still running"),
  );
  release();
  await vi.waitFor(() => expect(test.plain()).toContain("second line"));
  await vi.waitFor(() => expect(test.plain()).toMatch(/› next idea\s*$/));
  await test.chat.close();
});

it("previews an edit as a diff and applies it only when allowed", async () => {
  const test = await harness([
    async function* () {
      yield {
        type: "tool_call",
        id: "w1",
        name: "write_file",
        input: { path: "notes.txt", content: "one\nTWO\n" },
      };
      yield { type: "finish", reason: "tool_calls" };
    },
    async function* () {
      yield { type: "text_delta", text: "Updated." };
      yield finish;
    },
  ]);
  await writeFile(join(test.base, "notes.txt"), "one\ntwo\n");
  test.type("edit it\r");
  await vi.waitFor(() => expect(test.plain()).toContain("Allow this?"));
  expect(test.plain()).toContain("? Allow Write notes.txt");
  expect(test.plain()).toContain("-two");
  expect(test.plain()).toContain("+TWO");
  test.type("y");
  await vi.waitFor(() => expect(test.plain()).toContain("Updated."));
  expect(await readFile(join(test.base, "notes.txt"), "utf8")).toBe(
    "one\nTWO\n",
  );
  await vi.waitFor(() => expect(test.plain()).toContain("changed notes.txt"));
  await test.chat.close();
});

it("stops a run waiting for approval with Ctrl+C and denies the tool", async () => {
  const test = await harness([
    async function* () {
      yield {
        type: "tool_call",
        id: "r1",
        name: "run_terminal",
        input: { command: "touch should-not-exist" },
      };
      yield { type: "finish", reason: "tool_calls" };
    },
  ]);
  test.type("run it\r");
  await vi.waitFor(() => expect(test.plain()).toContain("$ touch"));
  test.type("\x03");
  await vi.waitFor(() => expect(test.plain()).toContain("Stopped."));
  await expect(readFile(join(test.base, "should-not-exist"))).rejects.toThrow();
  await test.chat.close();
});

it("handles commands locally and never sends them to the model", async () => {
  const test = await harness([
    async function* () {
      yield { type: "text_delta", text: "ok" };
      yield finish;
    },
  ]);
  test.type("/frobnicate\r");
  await vi.waitFor(() =>
    expect(test.plain()).toContain("Unknown command /frobnicate."),
  );
  test.type("/mode plan\r");
  await vi.waitFor(() => expect(test.plain()).toContain("Mode: plan"));
  test.type("--mode chat\r");
  await vi.waitFor(() => expect(test.plain()).toContain("Mode: chat"));
  test.type("/permissions auto-read\r");
  await vi.waitFor(() =>
    expect(test.plain()).toContain("Tool permissions: auto-read"),
  );
  test.type("/skills off\r");
  await vi.waitFor(() =>
    expect(test.plain()).toContain("Skills: off for this conversation"),
  );
  test.type("/help\r");
  await vi.waitFor(() => expect(test.plain()).toContain("Alt+Enter new line"));
  expect(test.requests).toHaveLength(0);
  test.type("hello\r");
  await vi.waitFor(() => expect(test.requests).toHaveLength(1));
  // Off mode means no skill catalog reaches the provider.
  expect(JSON.stringify(test.requests[0])).not.toContain("superpowers:");
  await test.chat.close();
});

it("exits on a second idle Ctrl+C within two seconds", async () => {
  const test = await harness([]);
  test.type("\x03");
  await vi.waitFor(() =>
    expect(test.plain()).toContain("Press Ctrl+C again to exit."),
  );
  test.tick(3_000);
  test.type("\x03");
  test.tick(500);
  let closed = false;
  void test.chat.closed.then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  test.type("\x03");
  await test.chat.closed;
});

it("saves conversations and resumes with unfinished tools marked unknown", async () => {
  const test = await harness(
    [
      async function* () {
        yield { type: "text_delta", text: "First answer" };
        yield finish;
      },
      async function* (request) {
        yield {
          type: "text_delta",
          text: JSON.stringify(request.messages).includes("First answer")
            ? "remembered"
            : "forgot",
        };
        yield finish;
      },
    ],
    "auto-all",
  );
  test.type("first question\r");
  await vi.waitFor(() => expect(test.plain()).toContain("First answer"));
  await vi.waitFor(async () =>
    expect(await test.conversations.list()).toHaveLength(1),
  );
  test.type("/new\r");
  await vi.waitFor(() =>
    expect(test.plain()).toContain("Started a new conversation."),
  );
  const [saved] = await test.conversations.list();
  // Simulate a crash mid-tool in the saved copy.
  const stored = await test.conversations.load(saved?.id ?? "");
  await test.conversations.save({
    ...(stored as NonNullable<typeof stored>),
    messages: [
      ...(stored?.messages ?? []),
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "lost", name: "write_file", input: {} }],
      },
    ],
  });
  test.type("/resume\r");
  await vi.waitFor(() => expect(test.plain()).toContain("1 first question"));
  test.type("/resume 1\r");
  await vi.waitFor(() => expect(test.plain()).toContain('Resumed "first'));
  test.type("again\r");
  await vi.waitFor(() => expect(test.plain()).toContain("remembered"));
  const history = JSON.stringify(test.requests.at(-1)?.messages);
  expect(history).toContain(unknownOutcome);
  await test.chat.close();
});
