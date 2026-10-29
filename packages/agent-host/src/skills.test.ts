import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentProfile,
  ModelProvider,
  ModelRequest,
  ModelStreamEvent,
} from "@truss-harness/runtime";
import { afterEach, describe, expect, it } from "vitest";
import {
  AgentHost,
  AgentProviderRegistry,
  createDefaultSkills,
} from "./index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function profile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: "builder",
    displayName: "Builder",
    provider: { providerId: "capture", modelId: "m" },
    mode: "edit",
    approvalPolicy: "ask",
    internetAccess: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function setup() {
  const base = await mkdtemp(join(tmpdir(), "truss-host-skills-"));
  roots.push(base);
  const workspace = join(base, "workspace");
  const config = join(base, "config");
  await mkdir(join(workspace, ".truss-harness", "skills", "repo-style"), {
    recursive: true,
  });
  await writeFile(
    join(workspace, ".truss-harness", "skills", "repo-style", "SKILL.md"),
    "---\nname: repo-style\ndescription: Repository style\n---\nREPO-MARKER\n",
  );
  const requests: ModelRequest[] = [];
  const registry = new AgentProviderRegistry();
  registry.register({
    descriptor: { id: "capture", label: "Capture", requiresCredential: false },
    async validate() {},
    async create() {
      return {
        id: "capture",
        async *stream(request): AsyncIterable<ModelStreamEvent> {
          requests.push(request);
          yield { type: "text_delta", text: "ok" };
          yield { type: "finish", reason: "stop" };
        },
      } satisfies ModelProvider;
    },
  });
  const skills = createDefaultSkills({
    workspaceRoot: workspace,
    userConfigDirectory: config,
  });
  const host = new AgentHost({
    workspaceRoot: workspace,
    providerRegistry: registry,
    skills,
  });
  return { workspace, base, requests, skills, host };
}
const system = (request: ModelRequest | undefined) =>
  request?.messages.find((message) => message.role === "system")?.content ?? "";

describe("AgentHost skills", () => {
  it("enables the Superpowers catalog by default and keeps workspace skills untrusted", async () => {
    const test = await setup();
    const hosted = await test.host.createRuntime(profile({ mode: "chat" }));
    const session = await hosted.runtime.createSession();
    await hosted.runtime.run(session.id, "What does this do?");
    await hosted.dispose();
    const prompt = system(test.requests[0]);
    expect(prompt).toContain("superpowers:brainstorming");
    expect(prompt).not.toContain("workspace:repo-style");
    expect(prompt).not.toContain("REPO-MARKER");
    expect(test.requests[0]?.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["load_skill", "request_user_input"]),
    );
    const listing = await test.skills.registry.list();
    expect(
      listing.skills.find((skill) => skill.id === "workspace:repo-style"),
    ).toMatchObject({ trusted: false });
  });

  it("never gives text-only helper runtimes skills", async () => {
    const test = await setup();
    const hosted = await test.host.createRuntime(profile(), { textOnly: true });
    const session = await hosted.runtime.createSession();
    await hosted.runtime.run(session.id, "Summarize the diff");
    await hosted.dispose();
    expect(system(test.requests[0])).not.toMatch(/skill/i);
    expect(test.requests[0]?.tools).toEqual([]);
  });

  it("applies agent and session settings, and imported skills reach the model", async () => {
    const test = await setup();
    await test.skills.store.import({
      kind: "directory",
      path: join(test.workspace, ".truss-harness", "skills", "repo-style"),
    });
    await test.skills.settings.setSettings(
      { workspaceRoot: test.workspace, agentId: "builder" },
      { mode: "manual", skillIds: ["user:repo-style"] },
    );
    const hosted = await test.host.createRuntime(profile());
    const first = await hosted.runtime.createSession();
    const second = await hosted.runtime.createSession();
    await test.skills.settings.setSettings(
      {
        workspaceRoot: test.workspace,
        agentId: "builder",
        sessionId: second.id,
      },
      { mode: "off" },
    );
    await hosted.runtime.run(first.id, "Explain the style");
    await hosted.runtime.run(second.id, "Explain the style");
    await hosted.dispose();
    expect(system(test.requests[0])).toContain("REPO-MARKER");
    expect(system(test.requests[0])).not.toContain("superpowers:");
    expect(system(test.requests[1])).not.toMatch(/skill/i);

    const other = await test.host.createRuntime(
      profile({ id: "reviewer", mode: "chat" }),
    );
    const third = await other.runtime.createSession();
    await other.runtime.run(third.id, "Review");
    await other.dispose();
    expect(system(test.requests[2])).toContain("superpowers:brainstorming");
  });
});
