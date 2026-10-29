import {
  type AgentRuntime,
  EventBus,
  type RuntimeEvent,
} from "@truss-harness/runtime";
import { afterEach, describe, expect, it } from "vitest";
import {
  type GatewaySkillController,
  type RunningRemoteGateway,
  startRemoteGateway,
} from "./index.js";

const token = "skills-token-with-enough-entropy";

async function post(gateway: RunningRemoteGateway, body: object) {
  const response = await fetch(`${gateway.url}/v1/commands`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return (await response.json()) as Record<string, unknown>;
}

let runtimes = 0;
function runtime() {
  const prefix = `runtime-${++runtimes}`;
  let next = 0;
  return {
    runtime: {
      createSession: async () => ({
        id: `${prefix}-session-${++next}`,
        createdAt: new Date(),
        updatedAt: new Date(),
        messages: [],
      }),
      run: async () => {},
    } as unknown as AgentRuntime,
    events: new EventBus<RuntimeEvent>(),
  };
}

describe("gateway skills", () => {
  let gateway: RunningRemoteGateway | undefined;
  afterEach(async () => {
    await gateway?.close();
  });

  it("lists skills and changes workspace and session settings only", async () => {
    const calls: unknown[] = [];
    const skills: GatewaySkillController = {
      list: async (sessionId) => {
        calls.push(["list", sessionId]);
        return {
          skills: [
            {
              id: "superpowers:brainstorming",
              name: "brainstorming",
              description: "Design first",
              source: "bundled",
              bundle: "superpowers",
              trusted: true,
            },
          ],
          selection: {
            mode: "automatic",
            superpowersEnabled: true,
            skillIds: [],
          },
        };
      },
      setSettings: async (scope, sessionId, selection) => {
        calls.push(["set", scope, sessionId, selection]);
        return {
          skills: [],
          selection: { mode: "manual", superpowersEnabled: true, skillIds: [] },
        };
      },
    };
    gateway = await startRemoteGateway({
      token,
      port: 0,
      workspaces: [
        {
          id: "one",
          displayName: "One",
          skills,
          createRuntime: async () => runtime(),
        },
        { id: "two", displayName: "Two", createRuntime: async () => runtime() },
      ],
    });
    const workspaces = (await (
      await fetch(`${gateway.url}/v1/workspaces`, {
        headers: { authorization: `Bearer ${token}` },
      })
    ).json()) as {
      workspaces: { id: string; capabilities: Record<string, unknown> }[];
    };
    expect(
      workspaces.workspaces.map((workspace) => [
        workspace.id,
        workspace.capabilities.supportsSkills ?? false,
      ]),
    ).toEqual([
      ["one", true],
      ["two", false],
    ]);

    const created = await post(gateway, {
      version: 2,
      requestId: "c",
      type: "create_session",
      workspaceId: "one",
      mode: "chat",
    });
    const other = await post(gateway, {
      version: 2,
      requestId: "c2",
      type: "create_session",
      workspaceId: "two",
      mode: "chat",
    });
    expect(
      await post(gateway, {
        version: 2,
        requestId: "l",
        type: "list_skills",
        workspaceId: "one",
      }),
    ).toMatchObject({
      type: "skills_listed",
      skills: [{ id: "superpowers:brainstorming" }],
      selection: { mode: "automatic" },
    });
    expect(
      await post(gateway, {
        version: 2,
        requestId: "s",
        type: "update_skill_settings",
        workspaceId: "one",
        scope: "session",
        sessionId: created.sessionId,
        selection: { mode: "manual", skillIds: ["superpowers:brainstorming"] },
      }),
    ).toEqual(
      expect.objectContaining({
        type: "skills_listed",
        selection: expect.objectContaining({ mode: "manual" }),
      }),
    );
    expect(calls).toEqual([
      ["list", undefined],
      [
        "set",
        "session",
        created.sessionId,
        { mode: "manual", skillIds: ["superpowers:brainstorming"] },
      ],
    ]);

    for (const [body, code] of [
      [{ type: "list_skills", workspaceId: "two" }, "not_authorized"],
      [
        { type: "list_skills", workspaceId: "one", version: 1 },
        "not_authorized",
      ],
      [
        { type: "list_skills", workspaceId: "one", sessionId: other.sessionId },
        "not_found",
      ],
      [
        {
          type: "update_skill_settings",
          workspaceId: "one",
          scope: "user",
          selection: {},
        },
        "invalid_command",
      ],
      [
        {
          type: "update_skill_settings",
          workspaceId: "one",
          scope: "session",
          selection: {},
        },
        "invalid_command",
      ],
      [
        {
          type: "update_skill_settings",
          workspaceId: "one",
          scope: "workspace",
          selection: { mode: "loud" },
        },
        "invalid_command",
      ],
      [
        {
          type: "update_skill_settings",
          workspaceId: "one",
          scope: "workspace",
          selection: { skillIds: ["/etc/passwd"] },
        },
        "invalid_command",
      ],
    ] as const)
      expect(
        await post(gateway, { version: 2, requestId: "x", ...body }),
        JSON.stringify(body),
      ).toMatchObject({ type: "rejected", code });
    expect(calls).toHaveLength(2);
  });
});
