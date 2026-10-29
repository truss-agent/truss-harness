import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import type { DesktopState } from "../shared.js";
import { dirname, join, sep } from "node:path";
import type {
  AgentProfile,
  AgentRunSummary,
  Session,
  ToolCall,
} from "@truss-harness/runtime";
import { describe, expect, it } from "vitest";
import {
  ManagedAgentService,
  createAgentApproval,
  managedAgentPlanPath,
} from "./managed-agent-service.js";

function profile(approvalPolicy: AgentProfile["approvalPolicy"]): AgentProfile {
  return {
    id: "agent-1",
    displayName: "Agent 1",
    provider: { providerId: "ollama", modelId: "test-model" },
    mode: "edit",
    approvalPolicy,
    internetAccess: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function call(name: string): ToolCall {
  return { id: `call-${name}`, name, input: {} };
}

const session: Session = {
  id: "session-1",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  messages: [],
};

describe("managed agent tool permissions", () => {
  it("auto-all permits mutating tools without prompting", async () => {
    const approval = createAgentApproval(profile("auto-all"));

    await expect(approval.approve(call("write_file"), session)).resolves.toBe(
      true,
    );
  });

  it("auto-read permits read-only tools without prompting", async () => {
    const approval = createAgentApproval(profile("auto-read"));

    await expect(approval.approve(call("read_file"), session)).resolves.toBe(
      true,
    );
  });

  it("auto-read still waits for approval before a mutating tool", async () => {
    const approval = createAgentApproval(profile("auto-read"));
    const pending = approval.approve(call("write_file"), session);

    expect(approval.resolve("call-write_file", false)).toBe(true);
    await expect(pending).resolves.toBe(false);
  });

  it("ask waits for approval even for read-only tools", async () => {
    const approval = createAgentApproval(profile("ask"));
    const pending = approval.approve(call("read_file"), session);

    expect(approval.resolve("call-read_file", true)).toBe(true);
    await expect(pending).resolves.toBe(true);
  });
});

describe("managed agent plan isolation", () => {
  it("stores each managed profile outside the primary workspace plan", () => {
    const first = managedAgentPlanPath("/workspace", "agent-1");
    const second = managedAgentPlanPath("/workspace", "agent-2");

    expect(first).not.toBe(
      join("/workspace", ".truss-harness", "plans", "active.json"),
    );
    expect(first).not.toBe(second);
    // Preserve the full isolation assertion across native path separators.
    expect(first.split(sep).join("/")).toMatch(
      /^\/workspace\/\.truss-harness\/agents\/[a-f0-9]{24}\/plans\/active\.json$/,
    );
  });
});

it.each(["preexisting", "after-initialization"])(
  "contains the actual Desktop managed plan factory with a %s nested symlink",
  async (timing) => {
    const base = await mkdtemp(join(tmpdir(), "truss-managed-plan-"));
    const root = join(base, "workspace"),
      outside = join(base, "outside");
    await mkdir(root);
    await mkdir(outside);
    const agent = { ...profile("auto-read"), mode: "plan" as const };
    const planPath = managedAgentPlanPath(root, agent.id);
    const planDirectory = dirname(planPath);
    await mkdir(dirname(planDirectory), { recursive: true });
    const canary = JSON.stringify({
      version: 1,
      id: "external",
      title: "outside-plan-canary",
      objective: "external",
      createdAt: "now",
      updatedAt: "now",
      status: "active",
      steps: [],
    });
    await writeFile(join(outside, "active.json"), canary);
    if (timing === "preexisting") await symlink(outside, planDirectory);
    let requestBody = "";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_input, init) => {
      requestBody = String(init?.body);
      if (timing === "after-initialization")
        await symlink(outside, planDirectory);
      return new Response(
        JSON.stringify({
          message: { content: "# Plan: Safe plan\n- [ ] Inspect workspace" },
          done: true,
        }) + "\n",
        { headers: { "content-type": "application/x-ndjson" } },
      );
    };
    let state: DesktopState = {
      workspaceRoot: root,
      zoomFactor: 1,
      updates: { checkOnLaunch: false, autoDownload: false },
      theme: { name: "default" },
      conversations: [],
      agentProfiles: [agent],
    };
    const service = new ManagedAgentService(
      () => state,
      (next) => {
        state = next;
      },
      async () => {},
      async () => undefined,
      () => {},
    );
    try {
      await service.configure();
      const coordinator = service.coordinator!;
      const terminal = new Promise<AgentRunSummary>((resolve) => {
        const unsubscribe = coordinator.events.subscribe((event) => {
          if (
            event.type === "run_updated" &&
            ["completed", "failed", "cancelled"].includes(event.run.state)
          ) {
            unsubscribe();
            resolve(event.run);
          }
        });
      });
      await service.start(agent.id, "Create a plan");
      const run = await terminal;
      expect(await readFile(join(outside, "active.json"), "utf8")).toBe(canary);
      expect(requestBody).not.toContain("outside-plan-canary");
      expect(run.state).toBe("failed");
      expect(run.error?.message).toMatch(/workspace/i);
    } finally {
      globalThis.fetch = originalFetch;
      await service.dispose();
      await rm(base, { recursive: true, force: true });
    }
  },
);
