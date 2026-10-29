import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentProviderRegistry,
  createDefaultSkills,
} from "@truss-harness/agent-host";
import type { ModelStreamEvent } from "@truss-harness/runtime";
import { afterEach, expect, it, vi } from "vitest";
import { RuntimeService, type RuntimeServiceMessage } from "./protocol.js";
import { createClientRuntime } from "./runtime.js";
import { skillServiceHost } from "./skills.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

it("sends an imported skill's instructions to the provider only when active", async () => {
  const base = await mkdtemp(join(tmpdir(), "truss-skills-integration-"));
  roots.push(base);
  const requests: string[] = [];
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
        async *stream(request): AsyncIterable<ModelStreamEvent> {
          requests.push(JSON.stringify(request));
          yield { type: "text_delta", text: "done" };
          yield { type: "finish", reason: "stop" };
        },
      };
    },
  });
  const skills = createDefaultSkills({
    workspaceRoot: base,
    userConfigDirectory: join(base, "config"),
  });
  const client = await createClientRuntime({
    workspaceRoot: base,
    provider: "openai-compatible",
    baseUrl: "http://fixture.invalid",
    model: "fixture",
    providerRegistry: providers,
    mode: "chat",
    skills,
  });
  const messages: RuntimeServiceMessage[] = [];
  const service = new RuntimeService({
    runtime: client.runtime,
    events: client.events,
    host: { skills: skillServiceHost(skills, base) },
    write: (message) => messages.push(message as RuntimeServiceMessage),
  });
  let sequence = 0;
  const send = async (request: Record<string, unknown>) => {
    const requestId = `r${++sequence}`;
    await service.handleLine(JSON.stringify({ ...request, requestId }));
    const reply = await vi.waitFor(() => {
      const found = messages.find(
        (message) =>
          "requestId" in message &&
          message.requestId === requestId &&
          (message.type === "response" || message.type === "error"),
      );
      if (!found) throw new Error(`No reply to ${requestId}`);
      return found;
    });
    expect(reply.type, JSON.stringify(reply)).toBe("response");
  };
  try {
    await send({ type: "initialize", protocolVersions: [1] });
    await send({
      type: "skills_import",
      content:
        "---\nname: release-notes\ndescription: Write release notes\n---\nAlways end with RELEASE-NOTES-MARKER.\n",
    });
    await send({
      type: "skills_settings",
      scope: "user",
      selection: { mode: "manual", skillIds: ["user:release-notes"] },
    });
    await send({ type: "run", prompt: "Summarize" });
    expect(requests.at(-1)).toContain("RELEASE-NOTES-MARKER");

    // Automatic mode lists the skill but does not load its body unprompted.
    await send({
      type: "skills_settings",
      scope: "user",
      selection: { mode: "automatic", skillIds: [] },
    });
    await send({ type: "run", prompt: "Summarize" });
    expect(requests.at(-1)).toContain("user:release-notes");
    expect(requests.at(-1)).not.toContain("RELEASE-NOTES-MARKER");

    await send({
      type: "skills_settings",
      scope: "user",
      selection: { mode: "off" },
    });
    await send({ type: "run", prompt: "Summarize" });
    expect(requests.at(-1)).not.toContain("user:release-notes");
  } finally {
    await client.dispose();
  }
});
