import { describe, expect, it } from "vitest";
import type { AgentRunHistoryStore, AgentRunSummary } from "./contracts.js";
import { BoundedAgentRunHistory } from "./run-history.js";

class RecordingHistoryStore implements AgentRunHistoryStore {
  readonly saves: (readonly AgentRunSummary[])[] = [];

  constructor(readonly loaded: readonly AgentRunSummary[] = []) {}

  async load(): Promise<readonly AgentRunSummary[]> {
    return this.loaded;
  }

  async save(runs: readonly AgentRunSummary[]): Promise<void> {
    this.saves.push(runs);
  }
}

function summary(
  id: string,
  completedAt: string,
  state: AgentRunSummary["state"] = "completed",
): AgentRunSummary {
  return {
    id,
    agentId: `agent-${id}`,
    state,
    prompt: `Run ${id}`,
    completedAt,
    changedFiles: [],
  };
}

describe("BoundedAgentRunHistory", () => {
  it("restores only valid terminal summaries within the retention limit", async () => {
    const store = new RecordingHistoryStore([
      summary("old", "2026-08-10T00:00:00.000Z"),
      summary("new", "2026-08-12T00:00:00.000Z"),
      summary("middle", "2026-08-11T00:00:00.000Z"),
      summary("active", "2026-08-13T00:00:00.000Z", "running"),
    ]);
    const history = new BoundedAgentRunHistory(2, store);

    await history.restore();

    expect(history.values().map((run) => run.id)).toEqual(["new", "middle"]);
    expect(history.get("old")).toBeUndefined();
    expect(history.get("active")).toBeUndefined();
  });

  it("persists the newest bounded terminal summaries", async () => {
    const store = new RecordingHistoryStore();
    const history = new BoundedAgentRunHistory(2, store);
    history.remember(summary("old", "2026-08-10T00:00:00.000Z"));
    history.remember(summary("new", "2026-08-12T00:00:00.000Z"));
    history.remember(summary("middle", "2026-08-11T00:00:00.000Z"));

    await history.persist();

    expect(store.saves).toHaveLength(1);
    expect(store.saves[0].map((run) => run.id)).toEqual(["new", "middle"]);
  });
});
