import type { AgentProfile, Session, ToolCall } from "@truss-harness/runtime";
import { describe, expect, it } from "vitest";
import {
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

    expect(first).not.toBe("/workspace/.truss-harness/plans/active.json");
    expect(first).not.toBe(second);
    expect(first).toMatch(
      /^\/workspace\/\.truss-harness\/agents\/[a-f0-9]{24}\/plans\/active\.json$/,
    );
  });
});
