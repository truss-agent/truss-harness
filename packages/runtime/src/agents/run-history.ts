import type {
  AgentRunHistoryStore,
  AgentRunState,
  AgentRunSummary,
} from "./contracts.js";

export function isTerminalAgentRunState(state: AgentRunState): boolean {
  return state === "completed" || state === "failed" || state === "cancelled";
}

export function agentRunSummaryTimestamp(run: AgentRunSummary): number {
  const timestamp = run.completedAt ?? run.startedAt;
  return timestamp ? Date.parse(timestamp) || 0 : 0;
}

function isHistoricalSummary(run: AgentRunSummary): boolean {
  return (
    typeof run.id === "string" &&
    typeof run.agentId === "string" &&
    typeof run.prompt === "string" &&
    isTerminalAgentRunState(run.state) &&
    (run.output === undefined || typeof run.output === "string") &&
    Array.isArray(run.changedFiles) &&
    run.changedFiles.every((path) => typeof path === "string")
  );
}

/** Owns validation, ordering, retention, and best-effort persistence of terminal runs. */
export class BoundedAgentRunHistory {
  private readonly summaries = new Map<string, AgentRunSummary>();
  private restored = false;

  constructor(
    private readonly maximum: number,
    private readonly store?: AgentRunHistoryStore,
  ) {}

  async restore(): Promise<void> {
    if (this.restored || !this.store) return;
    this.restored = true;
    const stored = await this.store.load().catch(() => []);
    for (const run of stored) {
      if (isHistoricalSummary(run)) this.summaries.set(run.id, run);
    }
    this.trim();
  }

  values(): readonly AgentRunSummary[] {
    return [...this.summaries.values()];
  }

  get(runId: string): AgentRunSummary | undefined {
    return this.summaries.get(runId);
  }

  delete(runId: string): void {
    this.summaries.delete(runId);
  }

  remember(run: AgentRunSummary): void {
    this.summaries.set(run.id, run);
    this.trim();
  }

  async persist(): Promise<void> {
    if (!this.store) return;
    await this.store.save(this.values()).catch(() => undefined);
  }

  private trim(): void {
    const retained = [...this.values()]
      .sort(
        (left, right) =>
          agentRunSummaryTimestamp(right) - agentRunSummaryTimestamp(left),
      )
      .slice(0, this.maximum);
    this.summaries.clear();
    for (const run of retained) this.summaries.set(run.id, run);
  }
}
