import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentProviderRegistry,
  createDefaultSkills,
} from "@truss-harness/agent-host";
import type {
  ModelRequest,
  ModelStreamEvent,
  ProcessRunRequest,
} from "@truss-harness/runtime";
import { afterEach, expect, it, vi } from "vitest";
import type { ResolvedConfiguration } from "../config.js";
import { createClientRuntime } from "../runtime.js";
import type { AgentState, AgentStatusReporter } from "./agent-status.js";
import { InteractiveChat, type InteractiveChatOptions } from "./controller.js";
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
  extra: (
    store: FileConversationStore,
  ) => Partial<InteractiveChatOptions> = () => ({}),
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
    ...extra(conversations),
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
  expect(test.plain()).toContain("2 - two");
  expect(test.plain()).toContain("2 + TWO");
  test.type("y");
  await vi.waitFor(() => expect(test.plain()).toContain("Updated."));
  expect(await readFile(join(test.base, "notes.txt"), "utf8")).toBe(
    "one\nTWO\n",
  );
  await vi.waitFor(() => expect(test.plain()).toContain("changed notes.txt"));
  expect(test.plain()).toContain(
    "⎿ Updated notes.txt with 1 addition and 1 removal",
  );
  // Already shown at the prompt, so the result doesn't repeat the diff.
  expect(test.plain().split("2 + TWO").length - 1).toBe(1);
  await test.chat.close();
});

it("shows written files as numbered code and edits as numbered diffs", async () => {
  const lines = Array.from(
    { length: 12 },
    (_, index) => `const v${index + 1} = ${index};`,
  );
  const test = await harness(
    [
      async function* (): AsyncGenerator<ModelStreamEvent> {
        yield {
          type: "tool_call",
          id: "w1",
          name: "write_file",
          input: { path: "src/new.ts", content: `${lines.join("\n")}\n` },
        };
        yield {
          type: "tool_call",
          id: "e1",
          name: "replace_in_file",
          input: { path: "notes.txt", oldText: "four", newText: "4\nfour" },
        };
        yield { type: "finish", reason: "tool_calls" };
      },
      async function* () {
        yield { type: "text_delta", text: "Done." };
        yield finish;
      },
    ],
    "auto-all",
    "edit",
  );
  await writeFile(
    join(test.base, "notes.txt"),
    "one\ntwo\nthree\nfour\nfive\nsix\nseven\n",
  );
  test.type("go\r");
  await vi.waitFor(() => expect(test.plain()).toContain("Done."));
  const output = test.plain();
  expect(output).toContain("● Write(src/new.ts)");
  expect(output).toContain("⎿ Wrote 12 lines to src/new.ts");
  expect(output).toMatch(/ {4} 1 const v1 = 0;/);
  expect(output).toMatch(/ {4}10 const v10 = 9;/);
  expect(output).not.toContain("const v11");
  expect(output).toContain("… +2 lines");
  expect(output).toContain("● Edit(notes.txt)");
  expect(output).toContain(
    "⎿ Updated notes.txt with 1 addition and 0 removals",
  );
  expect(output).toMatch(
    /2 {3}two\s+3 {3}three\s+4 \+ 4\s+5 {3}four\s+6 {3}five/,
  );
  expect(output).not.toContain("1   one");
  await test.chat.close();
});

it("names the tool in a coloured approval prompt without leaking escapes", async () => {
  const test = await harness(
    [
      async function* () {
        yield {
          type: "tool_call",
          id: "w1",
          name: "write_file",
          input: { path: "notes.txt", content: "one\n" },
        };
        yield { type: "finish", reason: "tool_calls" };
      },
    ],
    "ask",
    "edit",
    () => ({ style: createStyle(true) }),
  );
  test.type("edit it\r");
  await vi.waitFor(() => expect(test.plain()).toContain("Allow this?"));
  expect(test.plain()).toContain("? Allow Write notes.txt");
  await test.chat.close();
});

it("joins streamed progress fragments into one note", async () => {
  const test = await harness(
    [
      async function* () {
        yield { type: "text_delta", text: "<progress>Cre" };
        yield { type: "text_delta", text: "ating PO" };
        yield { type: "text_delta", text: "EM.md at the work" };
        yield { type: "text_delta", text: "space root.\n I just" };
        yield { type: "text_delta", text: " read it.</progress>Done." };
        yield finish;
      },
    ],
    "ask",
    "chat",
  );
  test.type("go\r");
  await vi.waitFor(() => expect(test.plain()).toContain("Done."));
  expect(test.plain()).toContain(
    "  Creating POEM.md at the workspace root. I just read it.\n",
  );
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

it("runs ! shell commands locally and sends their output with the next message", async () => {
  const runs: ProcessRunRequest[] = [];
  const test = await harness(
    [
      async function* () {
        yield { type: "text_delta", text: "Two files changed." };
        yield finish;
      },
    ],
    "ask",
    "chat",
    () => ({
      shell: {
        async run(request) {
          runs.push(request);
          return {
            output: " M a.ts\n M b.ts\n",
            exitCode: 0,
            outcome: "exited",
            truncated: false,
          };
        },
      },
    }),
  );
  test.type("!git status --short\r");
  await vi.waitFor(() => expect(test.plain()).toContain(" M b.ts"));
  expect(test.plain()).toContain("$ git status --short");
  expect(runs).toMatchObject([
    { command: "git status --short", cwd: test.base },
  ]);
  expect(test.requests).toHaveLength(0);
  test.type("what changed?\r");
  await vi.waitFor(() => expect(test.plain()).toContain("Two files changed."));
  const sent = JSON.stringify(test.requests[0]?.messages.at(-1));
  expect(sent).toContain("what changed?");
  expect(sent).toContain("$ git status --short");
  expect(sent).toContain(" M b.ts");
  await test.chat.close();
});

it("reports a failing ! command and stops a running one with Ctrl+C", async () => {
  let started!: () => void;
  const running = new Promise<void>((resolve) => {
    started = resolve;
  });
  const test = await harness([], "ask", "chat", () => ({
    shell: {
      async run(request) {
        if (request.command === "false")
          return {
            output: "",
            exitCode: 1,
            outcome: "exited",
            truncated: false,
          };
        started();
        await new Promise((resolve) =>
          request.signal?.addEventListener("abort", resolve),
        );
        return {
          output: "partial\n",
          exitCode: null,
          outcome: "aborted",
          truncated: false,
        };
      },
    },
  }));
  test.type("!false\r");
  await vi.waitFor(() => expect(test.plain()).toContain("exit code 1"));
  test.type("!sleep 100\r");
  await running;
  test.type("\x03");
  await vi.waitFor(() => expect(test.plain()).toContain("stopped"));
  expect(test.requests).toHaveLength(0);
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

function writeTurns(count: number): Turn[] {
  return Array.from({ length: count }, (_, index) => [
    async function* () {
      yield {
        type: "tool_call",
        id: `w${index}`,
        name: "write_file",
        input: { path: `f${index}.txt`, content: "x\n" },
      } satisfies ModelStreamEvent;
      yield { type: "finish", reason: "tool_calls" } satisfies ModelStreamEvent;
    },
    async function* () {
      yield {
        type: "text_delta",
        text: `done ${index}`,
      } satisfies ModelStreamEvent;
      yield finish;
    },
  ]).flat();
}

const prompts = (text: string) => text.split("? Allow Write").length - 1;

it("remembers an always-allow answer for the rest of the conversation", async () => {
  const test = await harness(writeTurns(2));
  test.type("one\r");
  await vi.waitFor(() => expect(test.plain()).toContain("Allow this?"));
  test.type("a");
  await vi.waitFor(() => expect(test.plain()).toContain("done 0"));
  expect(test.plain()).toContain("always: Write in this conversation");
  test.type("two\r");
  await vi.waitFor(() => expect(test.plain()).toContain("done 1"));
  expect(prompts(test.plain())).toBe(1);
  await test.chat.close();
});

it("saves workspace approvals outside the workspace and clears them", async () => {
  const test = await harness(writeTurns(3));
  test.type("one\r");
  await vi.waitFor(() => expect(test.plain()).toContain("Allow this?"));
  test.type("w");
  await vi.waitFor(() => expect(test.plain()).toContain("done 0"));
  const saved = JSON.parse(
    await readFile(join(test.base, "config", "approvals.json"), "utf8"),
  );
  expect(Object.values(saved.workspaces)).toEqual([[{ tool: "write_file" }]]);
  test.type("/new\r");
  await vi.waitFor(() =>
    expect(test.plain()).toContain("Started a new conversation."),
  );
  test.type("two\r");
  await vi.waitFor(() => expect(test.plain()).toContain("done 1"));
  expect(prompts(test.plain())).toBe(1);
  test.type("/permissions rules\r");
  await vi.waitFor(() =>
    expect(test.plain()).toContain("This workspace: Write"),
  );
  test.type("/permissions clear workspace\r");
  await vi.waitFor(() =>
    expect(test.plain()).toContain("Forgot workspace approvals."),
  );
  test.type("three\r");
  await vi.waitFor(() => expect(prompts(test.plain())).toBe(2));
  test.type("n");
  await test.chat.close();
});

it("restores a conversation's approvals and permission mode on resume", async () => {
  const test = await harness(writeTurns(2));
  test.type("one\r");
  await vi.waitFor(() => expect(test.plain()).toContain("Allow this?"));
  test.type("a");
  await vi.waitFor(() => expect(test.plain()).toContain("done 0"));
  test.type("/permissions auto-read\r");
  await vi.waitFor(() =>
    expect(test.plain()).toContain("Tool permissions: auto-read"),
  );
  test.type("/new\r");
  test.type("/permissions ask\r");
  await vi.waitFor(() =>
    expect(test.plain()).toContain("Tool permissions: ask"),
  );
  test.type("/resume 1\r");
  await vi.waitFor(() => expect(test.plain()).toContain('Resumed "one'));
  expect(test.plain()).toContain("run again. Tool permissions: auto-read.");
  test.type("two\r");
  await vi.waitFor(() => expect(test.plain()).toContain("done 1"));
  expect(prompts(test.plain())).toBe(1);
  await test.chat.close();
});

function recordingStatus() {
  const events: string[] = [];
  const reporter: AgentStatusReporter = {
    state: (state: AgentState, message?: string) => {
      events.push(message ? `${state}: ${message}` : state);
    },
    resumeCommand: (id, argv) => {
      events.push(`resume ${id ?? "-"} ${argv.join(" ")}`);
    },
    release: async () => {
      events.push("release");
    },
  };
  return { events, reporter };
}

it("reports working, blocked and idle, the resume command and release", async () => {
  const status = recordingStatus();
  const test = await harness(
    [
      async function* () {
        yield {
          type: "tool_call",
          id: "r1",
          name: "run_terminal",
          input: { command: "echo hi" },
        };
        yield { type: "finish", reason: "tool_calls" };
      },
      async function* () {
        yield { type: "text_delta", text: "Done." };
        yield finish;
      },
    ],
    "ask",
    "edit",
    () => ({
      agentStatus: status.reporter,
      resumeCommand: (id) => ["truss-cli", ...(id ? ["--resume", id] : [])],
    }),
  );
  expect(status.events).toEqual(["idle", "resume - truss-cli"]);
  test.type("run it\r");
  await vi.waitFor(() => expect(test.plain()).toContain("Allow this?"));
  test.type("n");
  await vi.waitFor(() => expect(test.plain()).toContain("Done."));
  await vi.waitFor(() => expect(status.events.at(-1)).toBe("idle"));
  const saved = (await test.conversations.list())[0]?.id;
  expect(status.events.slice(2)).toEqual([
    "working",
    "blocked: Allow run_terminal?",
    "working",
    `resume ${saved} truss-cli --resume ${saved}`,
    "idle",
  ]);
  await test.chat.close();
  expect(status.events.at(-1)).toBe("release");
});

it("resumes a saved conversation at start by its short ID", async () => {
  const first = await harness(
    [
      async function* () {
        yield { type: "text_delta", text: "First answer" };
        yield finish;
      },
    ],
    "auto-all",
  );
  first.type("first question\r");
  await vi.waitFor(async () =>
    expect(await first.conversations.list()).toHaveLength(1),
  );
  const id = (await first.conversations.list())[0]?.id ?? "";
  await first.chat.close();
  const resumed = await harness([], "auto-all", "edit", () => ({
    conversations: first.conversations,
    resumeConversationId: id.slice(0, 8),
  }));
  expect(resumed.plain()).toContain('Resumed "first question"');
  await resumed.chat.close();
  const missing = await harness([], "auto-all", "edit", () => ({
    resumeConversationId: "nope-nope-nope",
  }));
  expect(missing.plain()).toContain("Starting a new conversation.");
  await missing.chat.close();
});

it("opens numbered menus for /mode and /permissions", async () => {
  const test = await harness([]);
  test.type("/permissions\r");
  await vi.waitFor(() => expect(test.plain()).toContain("Tool approval"));
  expect(test.plain()).toContain("1. ask");
  test.type("3");
  await vi.waitFor(() =>
    expect(test.plain()).toContain("Tool permissions: auto-all"),
  );
  test.type("/mode\r");
  await vi.waitFor(() =>
    expect(test.plain()).toContain("Change files and run commands"),
  );
  test.type("\x1b[A");
  test.type("\r");
  await vi.waitFor(() => expect(test.plain()).toContain("Mode: plan"));
  test.type("/mode\r");
  await vi.waitFor(() =>
    expect(test.plain().split("Change files and run commands")).toHaveLength(3),
  );
  test.type("\x1b");
  await new Promise((resolve) => setTimeout(resolve, 60));
  test.type("/status\r");
  await vi.waitFor(() => expect(test.plain()).toContain("Mode plan"));
  await test.chat.close();
});

it("lists provider models in /model and switches without losing the conversation", async () => {
  const listModels = vi.fn(async () =>
    Array.from({ length: 12 }, (_, index) => `fixture-${index}`),
  );
  const test = await harness([], "ask", "edit", () => ({ listModels }));
  test.type("/model\r");
  await vi.waitFor(() =>
    expect(test.plain()).toContain("Model · openai-compatible"),
  );
  test.type("11");
  test.type("\r");
  await vi.waitFor(() =>
    expect(test.plain()).toContain("Model: fixture-11 for this session."),
  );
  test.type("/status\r");
  await vi.waitFor(() =>
    expect(test.plain()).toContain("openai-compatible/fixture-11"),
  );
  await test.chat.close();
});

it("attaches a pasted image path and a clipboard image to the next message", async () => {
  const seen: ModelRequest[] = [];
  const test = await harness(
    [
      async function* (request) {
        seen.push(request);
        yield { type: "text_delta", text: "Nice picture." };
        yield finish;
      },
    ],
    "ask",
    "chat",
    () => ({
      readClipboardImage: async () => ({
        name: "clipboard image",
        mediaType: "image/png",
        bytes: Buffer.from([1, 2, 3]),
      }),
    }),
  );
  await writeFile(join(test.base, "shot.png"), Buffer.from([137, 80, 78, 71]));
  test.type("look at ");
  test.type(`\x1b[200~${join(test.base, "shot.png")}\x1b[201~`);
  await vi.waitFor(() => expect(test.plain()).toContain("[image 1]"));
  test.type("\x16");
  await vi.waitFor(() => expect(test.plain()).toContain("[image 2]"));
  test.type("\r");
  await vi.waitFor(() => expect(test.plain()).toContain("Nice picture."));
  const user = [...(seen[0]?.messages ?? [])]
    .reverse()
    .find((message) => message.role === "user");
  expect(user?.attachments?.map((attachment) => attachment.name)).toEqual([
    "shot.png",
    "clipboard image",
  ]);
  expect(user?.attachments?.[1]?.data).toBe("data:image/png;base64,AQID");
  // Saved conversations keep image names but not their bytes.
  const id = (await test.conversations.list())[0]?.id ?? "";
  const saved = await test.conversations.load(id);
  expect(JSON.stringify(saved)).toContain("shot.png");
  expect(JSON.stringify(saved)).not.toContain("AQID");
  await test.chat.close();
});

it("pastes a path to a missing image as ordinary text", async () => {
  const test = await harness([]);
  test.type("\x1b[200~/nope/missing.png\x1b[201~");
  await vi.waitFor(() => expect(test.plain()).toContain("/nope/missing.png"));
  expect(test.plain()).not.toContain("[image");
  await test.chat.close();
});
