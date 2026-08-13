import type { AgentRunId } from "./contracts.js";

/** One holder at a time; a host may replace this with a durable or distributed lease. */
export interface WorkspaceWriteLease {
  holder(): AgentRunId | undefined;
  tryAcquire(runId: AgentRunId): boolean;
  release(runId: AgentRunId): boolean;
}

export class InMemoryWorkspaceWriteLease implements WorkspaceWriteLease {
  private heldBy: AgentRunId | undefined;

  holder(): AgentRunId | undefined {
    return this.heldBy;
  }

  tryAcquire(runId: AgentRunId): boolean {
    if (this.heldBy && this.heldBy !== runId) return false;
    this.heldBy = runId;
    return true;
  }

  release(runId: AgentRunId): boolean {
    if (this.heldBy !== runId) return false;
    this.heldBy = undefined;
    return true;
  }
}
