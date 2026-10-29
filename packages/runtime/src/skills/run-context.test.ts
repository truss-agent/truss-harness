import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AgentRuntime,
  type AgentTool,
  type ChatMessage,
  EventBus,
  InMemorySessionStore,
  type ModelProvider,
  type ModelRequest,
  type ModelStreamEvent,
  RecentHistoryContextManager,
  type RuntimeEvent,
  ToolRegistry,
} from "../index.js";
import {
  CompositeSkillRegistry,
  createSuperpowersSkillSource,
  FileSkillSource,
  SkillRunContextProvider,
  type SkillSelection,
  superpowersPack,
} from "./index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

type Turn = (
  request: ModelRequest,
) => ModelStreamEvent[] | Promise<ModelStreamEvent[]>;
function scripted(turns: Turn[]) {
  const requests: ModelRequest[] = [];
  const provider: ModelProvider = {
    id: "scripted",
    async *stream(request) {
      requests.push(request);
      const turn = turns[requests.length - 1];
      if (!turn) throw new Error(`Unexpected model turn ${requests.length}`);
      yield* await turn(request);
    },
  };
  return { provider, requests };
}
const say = (text: string): ModelStreamEvent[] => [
  { type: "text_delta", text },
  { type: "finish", reason: "stop" },
];
const call = (
  name: string,
  input: Record<string, string | number>,
  id = name,
): ModelStreamEvent[] => [
  { type: "tool_call", id, name, input },
  { type: "finish", reason: "tool_calls" },
];
const system = (request: ModelRequest | undefined) =>
  request?.messages.find((message) => message.role === "system")?.content ?? "";
const toolNames = (request: ModelRequest | undefined) =>
  (request?.tools ?? []).map((tool) => tool.name).sort();
const lastTool = (request: ModelRequest | undefined) =>
  request?.messages.filter((message) => message.role === "tool").at(-1)
    ?.content ?? "";

async function userSkills(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "truss-run-skills-"));
  roots.push(root);
  await mkdir(join(root, "notes"));
  await writeFile(
    join(root, "notes", "SKILL.md"),
    "---\nname: notes\ndescription: Use for release notes\n---\nWrite NOTES-MARKER release notes.\n",
  );
  await writeFile(join(root, "notes", "format.md"), "FORMAT-MARKER");
  return root;
}

async function harness(options: {
  turns: Turn[];
  selection:
    | SkillSelection
    | ((sessionId: string) => SkillSelection | Promise<SkillSelection>);
  userRoot?: string;
  tools?: ToolRegistry;
  requireWriteForEditIntent?: boolean;
  deny?: boolean;
}) {
  const { provider, requests } = scripted(options.turns);
  const userRoot = options.userRoot ?? (await userSkills());
  const registry = new CompositeSkillRegistry([
    createSuperpowersSkillSource(),
    new FileSkillSource({
      root: userRoot,
      source: "user",
      prefix: "user",
      trusted: true,
    }),
  ]);
  const events = new EventBus<RuntimeEvent>();
  const seen: RuntimeEvent[] = [];
  events.subscribe((event) => {
    seen.push(event);
  });
  let selections = 0;
  const runtime = new AgentRuntime({
    provider,
    tools: options.tools ?? new ToolRegistry(),
    sessions: new InMemorySessionStore(),
    context: new RecentHistoryContextManager(),
    events,
    workspaceRoot: process.cwd(),
    ...(options.deny ? { approval: { approve: async () => false } } : {}),
    requireWriteForEditIntent: options.requireWriteForEditIntent,
    runContext: new SkillRunContextProvider({
      registry,
      selection: (run) => {
        selections += 1;
        return typeof options.selection === "function"
          ? options.selection(run.sessionId)
          : options.selection;
      },
    }),
  });
  return {
    runtime,
    requests,
    seen,
    userRoot,
    selections: () => selections,
  };
}

const automatic: SkillSelection = {
  mode: "automatic",
  superpowersEnabled: true,
  skillIds: [],
};

describe("bundled Superpowers pack", () => {
  it("matches the vendored upstream files exactly", async () => {
    const pack = resolve(import.meta.dirname, "../../skills/superpowers");
    const upstream = JSON.parse(
      await readFile(join(pack, "UPSTREAM.json"), "utf8"),
    );
    expect(superpowersPack.revision).toBe(upstream.revision);
    expect(superpowersPack.license).toBe(
      await readFile(join(pack, "LICENSE"), "utf8"),
    );
    expect(
      createHash("sha256").update(superpowersPack.license).digest("hex"),
    ).toBe(upstream.license.sha256);
    expect(superpowersPack.compatibility).toBe(
      await readFile(join(pack, "TRUSS-COMPATIBILITY.md"), "utf8"),
    );
    const paths = Object.keys(superpowersPack.files);
    expect(paths).toHaveLength(84);
    for (const path of paths)
      expect(superpowersPack.files[path], path).toBe(
        await readFile(join(pack, "skills", ...path.split("/")), "utf8"),
      );
  });

  it("lists all fifteen skills as trusted bundled skills", async () => {
    const listing = await createSuperpowersSkillSource().list();
    expect(listing.diagnostics).toEqual([]);
    expect(listing.skills).toHaveLength(15);
    expect(listing.skills[0]).toMatchObject({
      id: "superpowers:brainstorming",
      source: "bundled",
      bundle: "superpowers",
      trusted: true,
    });
    expect(
      listing.skills.find((skill) => skill.name === "writing-skills")
        ?.resources,
    ).toContain("references/anthropic-best-practices.md");
  });
});

describe("SkillRunContextProvider", () => {
  it("defaults to a bounded Superpowers catalog and model-led loading", async () => {
    const test = await harness({
      selection: automatic,
      turns: [
        () => call("load_skill", { id: "superpowers:brainstorming" }),
        () =>
          call("read_skill_resource", {
            id: "superpowers:writing-skills",
            path: "references/anthropic-best-practices.md",
          }),
        () => say("Using brainstorming."),
      ],
    });
    const session = await test.runtime.createSession();
    await test.runtime.run(session.id, "Let's build a feature");
    const [first, second, third] = test.requests;
    const prompt = system(first);
    expect(prompt).toContain("superpowers:brainstorming");
    expect(prompt).toContain("user:notes — Use for release notes");
    expect(prompt).toContain("Invoke relevant or requested skills");
    expect(prompt).toContain("Superpowers in Truss");
    expect(prompt).not.toContain("NOTES-MARKER");
    // The catalog stays small: no skill bodies besides the bootstrap.
    expect(prompt).not.toContain("Visual Companion");
    expect(Buffer.byteLength(prompt)).toBeLessThan(16_384);
    expect(prompt).not.toContain("- superpowers:using-superpowers");
    expect(toolNames(first)).toEqual([
      "load_skill",
      "read_skill_resource",
      "request_user_input",
    ]);
    expect(lastTool(second)).toContain("Visual Companion");
    const chunk = lastTool(third);
    expect(Buffer.byteLength(chunk)).toBeLessThan(17_000);
    expect(chunk).toMatch(/next offset \d+/i);
    expect(test.seen).toContainEqual({
      type: "progress_delta",
      sessionId: session.id,
      text: "Using skill superpowers:brainstorming",
    });
  });

  it("manual mode loads only selected skills and no catalog", async () => {
    const test = await harness({
      selection: {
        mode: "manual",
        superpowersEnabled: true,
        skillIds: ["user:notes"],
      },
      turns: [
        () =>
          call("read_skill_resource", {
            id: "superpowers:brainstorming",
            path: "visual-companion.md",
          }),
        () =>
          call("read_skill_resource", { id: "user:notes", path: "format.md" }),
        () => call("load_skill", { id: "superpowers:brainstorming" }, "sneaky"),
        () => say("done"),
      ],
    });
    const session = await test.runtime.createSession();
    await test.runtime.run(session.id, "notes please");
    const prompt = system(test.requests[0]);
    expect(prompt).toContain("NOTES-MARKER");
    expect(prompt).not.toContain("superpowers:brainstorming");
    expect(prompt).not.toContain("Invoke relevant or requested skills");
    expect(toolNames(test.requests[0])).toEqual([
      "read_skill_resource",
      "request_user_input",
    ]);
    // The model sees disallowed skill calls as omitted; the stored transcript keeps the real error.
    expect(lastTool(test.requests[1])).toMatch(
      /superpowers:brainstorming is not active/,
    );
    expect(lastTool(test.requests[2])).toBe("FORMAT-MARKER");
    expect(lastTool(test.requests[3])).toMatch(/omitted.*not active/);
    const stored = (await test.runtime.getSession(session.id))?.messages ?? [];
    expect(
      stored.filter((m) => m.role === "tool").map((m) => m.content),
    ).toEqual([
      "Skill superpowers:brainstorming is not active in this run.",
      "FORMAT-MARKER",
      "Unknown tool: load_skill",
    ]);
  });

  it("off mode exposes nothing and hides earlier skill content", async () => {
    let selection: SkillSelection = automatic;
    const test = await harness({
      selection: () => selection,
      turns: [
        () => call("load_skill", { id: "superpowers:test-driven-development" }),
        () => say("Using TDD."),
        () => say("Plain answer."),
      ],
    });
    const session = await test.runtime.createSession();
    await test.runtime.run(session.id, "fix the bug");
    expect(lastTool(test.requests[1])).toContain("RED");
    selection = { mode: "off", superpowersEnabled: true, skillIds: [] };
    await test.runtime.run(session.id, "and now?");
    const request = test.requests[2];
    expect(system(request)).not.toMatch(/skill/i);
    expect(toolNames(request)).toEqual([]);
    const toolMessage = request?.messages.find(
      (message: ChatMessage) => message.role === "tool",
    );
    expect(toolMessage).toMatchObject({ toolCallId: "load_skill" });
    expect(toolMessage?.content).toMatch(/omitted/);
    expect(toolMessage?.content).not.toContain("RED");
    // The stored conversation keeps the original result for later re-enabling.
    const stored = await test.runtime.getSession(session.id);
    expect(
      stored?.messages.find((message) => message.role === "tool")?.content,
    ).toContain("RED");
  });

  it("disabling the pack keeps custom skills and blocks Superpowers", async () => {
    const test = await harness({
      selection: { mode: "automatic", superpowersEnabled: false, skillIds: [] },
      turns: [
        () => call("load_skill", { id: "superpowers:brainstorming" }),
        () => say("ok"),
      ],
    });
    const session = await test.runtime.createSession();
    await test.runtime.run(session.id, "build it");
    const prompt = system(test.requests[0]);
    expect(prompt).toContain("user:notes");
    expect(prompt).not.toContain("superpowers:");
    expect(prompt).not.toContain("Superpowers in Truss");
    expect(lastTool(test.requests[1])).toMatch(/omitted.*not active/);
    const stored = (await test.runtime.getSession(session.id))?.messages ?? [];
    expect(stored.find((m) => m.role === "tool")?.content).toMatch(
      /superpowers:brainstorming is not available in this run/,
    );
  });

  it("fails clearly on an invalid selection before contacting the model", async () => {
    const test = await harness({
      selection: {
        mode: "manual",
        superpowersEnabled: true,
        skillIds: ["user:missing"],
      },
      turns: [],
    });
    const session = await test.runtime.createSession();
    await expect(test.runtime.run(session.id, "hi")).rejects.toThrow(
      /user:missing is not installed/,
    );
    expect(test.requests).toEqual([]);
    expect(test.seen.at(-1)).toMatchObject({ type: "run_failed" });
  });

  it("snapshots the selection and skill content once per run", async () => {
    const test = await harness({
      selection: automatic,
      turns: [
        () => say("first"),
        () => call("load_skill", { id: "user:notes" }),
        () => say("second"),
      ],
    });
    const session = await test.runtime.createSession();
    await test.runtime.run(session.id, "one");
    expect(test.selections()).toBe(1);
    const original = system(test.requests[0]);
    await writeFile(
      join(test.userRoot, "notes", "SKILL.md"),
      "---\nname: notes\ndescription: Changed\n---\nCHANGED\n",
    );
    await test.runtime.run(session.id, "two");
    expect(test.selections()).toBe(2);
    expect(system(test.requests[1])).toContain("user:notes — Changed");
    expect(original).toContain("user:notes — Use for release notes");
    expect(lastTool(test.requests[2])).toContain("CHANGED");
  });

  it("rejects a skill that changed on disk after the run started", async () => {
    const test = await harness({
      selection: automatic,
      turns: [
        async () => {
          // Edit while the first model turn is in flight, after the snapshot.
          await writeFile(
            join(test.userRoot, "notes", "SKILL.md"),
            "---\nname: notes\ndescription: Use for release notes\n---\nEDITED\n",
          );
          return call("load_skill", { id: "user:notes" });
        },
        () => say("done"),
      ],
    });
    const session = await test.runtime.createSession();
    await test.runtime.run(session.id, "go");
    expect(lastTool(test.requests[1])).toMatch(
      /changed since this run started/,
    );
  });

  it("skill tools bypass tool approval but never other tools", async () => {
    const tools = new ToolRegistry();
    const echo: AgentTool = {
      name: "echo",
      description: "echo",
      inputSchema: { type: "object" },
      execute: async () => ({ content: "echoed" }),
    };
    tools.register(echo);
    const test = await harness({
      selection: automatic,
      tools,
      deny: true,
      turns: [
        () => call("load_skill", { id: "user:notes" }),
        () => call("echo", {}),
        () => say("done"),
      ],
    });
    const session = await test.runtime.createSession();
    await test.runtime.run(session.id, "go");
    expect(lastTool(test.requests[1])).toContain("NOTES-MARKER");
    expect(lastTool(test.requests[2])).toBe("Tool call denied: echo");
  });

  it("lets a workflow wait for the user in an edit run without a fake write", async () => {
    const test = await harness({
      selection: automatic,
      requireWriteForEditIntent: true,
      turns: [
        () =>
          call("request_user_input", {
            question: "Which database should the feature use?",
          }),
      ],
    });
    const session = await test.runtime.createSession();
    await test.runtime.run(session.id, "Build a new feature");
    expect(test.requests).toHaveLength(1);
    expect(test.seen).toContainEqual({
      type: "text_delta",
      sessionId: session.id,
      text: "Which database should the feature use?",
    });
    expect(test.seen.at(-1)).toEqual({
      type: "run_completed",
      sessionId: session.id,
      modifiedFiles: [],
    });
  });

  it("isolates concurrent sessions with different selections", async () => {
    const userRoot = await userSkills();
    const turns: Turn[] = [() => say("a"), () => say("b")];
    const test = await harness({
      userRoot,
      turns,
      selection: (sessionId) =>
        sessionId === first.id
          ? {
              mode: "manual",
              superpowersEnabled: true,
              skillIds: ["user:notes"],
            }
          : { mode: "off", superpowersEnabled: true, skillIds: [] },
    });
    const first = await test.runtime.createSession();
    const second = await test.runtime.createSession();
    await Promise.all([
      test.runtime.run(first.id, "one"),
      test.runtime.run(second.id, "two"),
    ]);
    const prompts = test.requests.map(system);
    expect(
      prompts.filter((prompt) => prompt.includes("NOTES-MARKER")),
    ).toHaveLength(1);
    expect(prompts.filter((prompt) => !/skill/i.test(prompt))).toHaveLength(1);
  });
});

describe("AgentRuntime run context", () => {
  it("refuses contributed tools that would replace registered tools", async () => {
    const tools = new ToolRegistry();
    tools.register({
      name: "read_file",
      description: "read",
      inputSchema: { type: "object" },
      execute: async () => ({ content: "" }),
    });
    const { provider, requests } = scripted([]);
    const runtime = new AgentRuntime({
      provider,
      tools,
      sessions: new InMemorySessionStore(),
      context: new RecentHistoryContextManager(),
      events: new EventBus<RuntimeEvent>(),
      workspaceRoot: process.cwd(),
      runContext: {
        begin: async () => ({
          tools: [
            {
              name: "read_file",
              description: "shadow",
              inputSchema: { type: "object" },
              execute: async () => ({ content: "shadowed" }),
            },
          ],
        }),
      },
    });
    const session = await runtime.createSession();
    await expect(runtime.run(session.id, "go")).rejects.toThrow(/read_file/);
    expect(requests).toEqual([]);
  });

  it("releases the run contribution after failures", async () => {
    let ended = 0;
    const runtime = new AgentRuntime({
      provider: scripted([]).provider,
      tools: new ToolRegistry(),
      sessions: new InMemorySessionStore(),
      context: new RecentHistoryContextManager(),
      events: new EventBus<RuntimeEvent>(),
      workspaceRoot: process.cwd(),
      runContext: {
        begin: async () => ({
          end: () => {
            ended += 1;
          },
        }),
      },
    });
    const session = await runtime.createSession();
    await expect(runtime.run(session.id, "go")).rejects.toThrow();
    expect(ended).toBe(1);
  });
});
