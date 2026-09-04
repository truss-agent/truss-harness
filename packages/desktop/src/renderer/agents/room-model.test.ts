import type { AgentProfile, AgentRunSummary } from "@truss-harness/runtime";
import { describe, expect, it } from "vitest";
import { handoffBrief, roomAgents } from "./room-model.js";

const profile: AgentProfile = {
  id: "planner",
  displayName: "Planner",
  mode: "plan",
  approvalPolicy: "ask",
  internetAccess: false,
  createdAt: "",
  updatedAt: "",
  provider: { providerId: "local", modelId: "example" },
};
const run: AgentRunSummary = {
  id: "run",
  agentId: profile.id,
  state: "running",
  prompt: "Plan the work",
  changedFiles: [],
  startedAt: "2026-09-04T10:00:00Z",
};

describe("agent room runtime projection", () => {
  it("places real planning at the table and edit work at desks", () => {
    expect(roomAgents({ profiles: [profile], runs: [run] })[0].zone).toBe(
      "meeting",
    );
    expect(
      roomAgents({ profiles: [{ ...profile, mode: "edit" }], runs: [run] })[0]
        .zone,
    ).toBe("desk");
  });
  it.each(["queued", "waiting_for_approval", "failed", "cancelled"] as const)(
    "does not depict %s as planning or completed",
    (state) => {
      expect(
        roomAgents({ profiles: [profile], runs: [{ ...run, state }] })[0],
      ).toMatchObject({ zone: "desk", status: state.replaceAll("_", " ") });
    },
  );
  it("prefers an active run over history and sorts unordered history by time", () => {
    const old = {
      ...run,
      id: "old",
      state: "completed" as const,
      startedAt: "2026-09-03T10:00:00Z",
    };
    const latest = {
      ...run,
      id: "latest",
      state: "completed" as const,
      startedAt: "2026-09-05T10:00:00Z",
    };
    expect(
      roomAgents({ profiles: [profile], runs: [latest, run, old] })[0].run?.id,
    ).toBe(run.id);
    expect(
      roomAgents({ profiles: [profile], runs: [latest, old] })[0],
    ).toMatchObject({ zone: "handoff", run: { id: "latest" } });
  });
  it("keeps idle profiles visible and only marks the explicitly selected lead", () => {
    expect(
      roomAgents({ profiles: [profile], runs: [] }, profile.id)[0],
    ).toMatchObject({ status: "idle", lead: true, zone: "desk" });
    expect(
      roomAgents({ profiles: [profile], runs: [] }, "deleted")[0].lead,
    ).toBe(false);
    expect(roomAgents({ profiles: [], runs: [run] })).toEqual([]);
  });
  it("hands off actual completed output and verified files without inventing results", () => {
    const completed = {
      ...run,
      state: "completed" as const,
      output: "A plan",
      changedFiles: ["src/app.ts"],
    };
    expect(JSON.parse(handoffBrief(completed))).toEqual({
      sourceRunId: run.id,
      task: run.prompt,
      response: "A plan",
      changedFiles: ["src/app.ts"],
    });
    expect(() => handoffBrief(run)).toThrow("Only completed work");
  });
});
