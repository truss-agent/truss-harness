import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDefaultSkills } from "@truss-harness/agent-host";
import { EventBus, type RuntimeEvent } from "@truss-harness/runtime";
import { afterEach, describe, expect, it } from "vitest";
import {
  LOCAL_SERVICE_PROTOCOL_VERSION,
  RuntimeService,
  type RuntimeServiceHost,
  type RuntimeServiceMessage,
} from "../protocol.js";
import { skillServiceHost } from "../skills.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function service(host: RuntimeServiceHost | undefined) {
  const messages: RuntimeServiceMessage[] = [];
  const runtime = {
    createSession: async () => ({
      id: "s1",
      createdAt: new Date(),
      updatedAt: new Date(),
      messages: [],
    }),
    getSession: async () => undefined,
    run: async () => {},
  };
  const value = new RuntimeService({
    runtime,
    events: new EventBus<RuntimeEvent>(),
    host,
    serverVersion: "test",
    write: (message) => messages.push(message as RuntimeServiceMessage),
  });
  await value.handleLine(
    JSON.stringify({
      type: "initialize",
      requestId: "init",
      protocolVersions: [LOCAL_SERVICE_PROTOCOL_VERSION],
    }),
  );
  const send = async (request: Record<string, unknown>) => {
    const requestId = `r${messages.length}`;
    await value.handleLine(JSON.stringify({ ...request, requestId }));
    return messages.find(
      (message) => "requestId" in message && message.requestId === requestId,
    );
  };
  return { messages, send };
}

async function workspace() {
  const base = await mkdtemp(join(tmpdir(), "truss-protocol-skills-"));
  roots.push(base);
  const root = join(base, "workspace");
  const source = join(base, "source", "notes");
  await mkdir(root, { recursive: true });
  await mkdir(source, { recursive: true });
  await writeFile(
    join(source, "SKILL.md"),
    "---\nname: notes\ndescription: Release notes\n---\nBody\n",
  );
  const skills = createDefaultSkills({
    workspaceRoot: root,
    userConfigDirectory: join(base, "config"),
  });
  return { base, root, source, skills };
}

describe("skills protocol", () => {
  it("advertises skills and runs list, import, settings and remove", async () => {
    const test = await workspace();
    const { messages, send } = await service({
      skills: skillServiceHost(test.skills, test.root),
    });
    expect(messages[0]).toMatchObject({
      result: { capabilities: { skills: true, skillManagement: true } },
    });

    const listed = await send({ type: "skills_list" });
    expect(listed).toMatchObject({
      type: "response",
      result: {
        skills: {
          selection: {
            mode: "automatic",
            superpowersEnabled: true,
            skillIds: [],
          },
        },
      },
    });
    if (listed?.type !== "response") throw new Error("expected response");
    expect(listed.result.skills?.skills.length).toBe(15);
    expect(JSON.stringify(listed)).not.toContain(test.base);

    expect(
      await send({ type: "skills_import", path: test.source }),
    ).toMatchObject({ result: { skill: { id: "user:notes", trusted: true } } });
    expect(
      await send({
        type: "skills_settings",
        scope: "session",
        sessionId: "s1",
        selection: { mode: "manual", skillIds: ["user:notes"] },
      }),
    ).toMatchObject({
      result: {
        skills: {
          selection: {
            mode: "manual",
            superpowersEnabled: true,
            skillIds: ["user:notes"],
          },
        },
      },
    });
    expect(await send({ type: "skills_list" })).toMatchObject({
      result: { skills: { selection: { mode: "automatic" } } },
    });
    expect(
      await send({
        type: "skills_settings",
        scope: "workspace",
        selection: { superpowersEnabled: false },
      }),
    ).toMatchObject({
      result: { skills: { selection: { superpowersEnabled: false } } },
    });
    expect(
      await send({
        type: "skills_settings",
        scope: "workspace",
        selection: null,
      }),
    ).toMatchObject({
      result: { skills: { selection: { superpowersEnabled: true } } },
    });
    expect(
      await send({ type: "skills_remove", id: "user:notes" }),
    ).toMatchObject({ result: { removed: true } });
  });

  it("speaks JSON-RPC methods", async () => {
    const test = await workspace();
    const messages: unknown[] = [];
    const value = new RuntimeService({
      runtime: {
        createSession: async () => ({
          id: "s",
          createdAt: new Date(),
          updatedAt: new Date(),
          messages: [],
        }),
        getSession: async () => undefined,
        run: async () => {},
      },
      events: new EventBus<RuntimeEvent>(),
      host: { skills: skillServiceHost(test.skills, test.root) },
      write: (message) => messages.push(message),
    });
    await value.handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "1",
        method: "initialize",
        params: { protocolVersions: [LOCAL_SERVICE_PROTOCOL_VERSION] },
      }),
    );
    await value.handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "2",
        method: "skills/settings",
        params: { scope: "user", selection: { mode: "off" } },
      }),
    );
    expect(messages.at(-1)).toMatchObject({
      jsonrpc: "2.0",
      id: "2",
      result: { skills: { selection: { mode: "off" } } },
    });
  });

  it("rejects malformed requests before any side effect", async () => {
    const test = await workspace();
    const { send } = await service({
      skills: skillServiceHost(test.skills, test.root),
    });
    for (const request of [
      { type: "skills_settings", scope: "galaxy", selection: {} },
      { type: "skills_settings", scope: "session", selection: { mode: "off" } },
      { type: "skills_settings", scope: "user", selection: { mode: "loud" } },
      {
        type: "skills_settings",
        scope: "user",
        selection: { skillIds: ["../x"] },
      },
      { type: "skills_import", path: "relative/dir" },
      { type: "skills_import", path: test.source, content: "both" },
      { type: "skills_import", content: "x".repeat(70_000) },
      { type: "skills_import", content: "---", resources: [{ path: "a" }] },
      { type: "skills_remove" },
      { type: "skills_list", sessionId: 5 },
    ])
      expect(
        await send(request),
        JSON.stringify(request).slice(0, 80),
      ).toMatchObject({
        type: "error",
        code: "invalid_request",
      });
    expect(await readdir(join(test.base, "config")).catch(() => [])).toEqual(
      [],
    );
    // Store-level rejections (traversal resource) also leave nothing behind.
    expect(
      await send({
        type: "skills_import",
        content: "---\nname: evil\ndescription: x\n---\n",
        resources: [{ path: "../../escape.md", content: "x" }],
      }),
    ).toMatchObject({ type: "error" });
    expect(await readdir(join(test.base, "config")).catch(() => [])).toEqual(
      [],
    );
  });

  it("reports skills as unavailable on hosts without them", async () => {
    const test = await workspace();
    const plain = await service(undefined);
    expect(plain.messages[0]).toMatchObject({
      result: { capabilities: { skills: false, skillManagement: false } },
    });
    expect(await plain.send({ type: "skills_list" })).toMatchObject({
      type: "error",
      code: "method_not_found",
    });
    const listOnly = await service({
      skills: skillServiceHost(test.skills, test.root, { manage: false }),
    });
    expect(listOnly.messages[0]).toMatchObject({
      result: { capabilities: { skills: true, skillManagement: false } },
    });
    expect(
      await listOnly.send({ type: "skills_import", path: test.source }),
    ).toMatchObject({ type: "error", code: "method_not_found" });
  });
});
