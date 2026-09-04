import type { AgentProfile, AgentRunSummary } from "@truss-harness/runtime";

export interface RoomSnapshot {
  readonly profiles: readonly AgentProfile[];
  readonly runs: readonly AgentRunSummary[];
}

export interface RoomAgent {
  readonly id: string;
  readonly name: string;
  readonly zone: "desk" | "meeting" | "handoff";
  readonly status: string;
  readonly lead: boolean;
  readonly run?: AgentRunSummary;
}

export function isActiveRun(run: AgentRunSummary): boolean {
  return ["queued", "running", "waiting_for_approval"].includes(run.state);
}

/** Pure projection: positions never invent execution or successful completion. */
export function roomAgents(
  snapshot: RoomSnapshot,
  leadId?: string,
): RoomAgent[] {
  return snapshot.profiles.map((profile) => {
    const runs = snapshot.runs.filter((run) => run.agentId === profile.id);
    const latest = (values: readonly AgentRunSummary[]) =>
      [...values]
        .sort((a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? ""))
        .at(-1);
    const run = latest(runs.filter(isActiveRun)) ?? latest(runs);
    const planning = profile.mode === "plan" && run?.state === "running";
    return {
      id: profile.id,
      name: profile.displayName,
      lead: profile.id === leadId,
      zone:
        run?.state === "completed" ? "handoff" : planning ? "meeting" : "desk",
      status: planning
        ? "Planning"
        : (run?.state.replaceAll("_", " ") ?? "idle"),
      run,
    };
  });
}

/** Serialize completed work for an editable, explicitly user-directed handoff. */
export function handoffBrief(run: AgentRunSummary): string {
  if (run.state !== "completed")
    throw new Error("Only completed work can be handed in.");
  return JSON.stringify(
    {
      sourceRunId: run.id,
      task: run.prompt,
      response: run.output ?? "",
      changedFiles: run.changedFiles,
    },
    null,
    2,
  );
}
