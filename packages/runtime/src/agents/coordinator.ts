import { randomUUID } from "node:crypto";
import type { ChatAttachment, RuntimeEvent } from "../contracts.js";
import { EventBus } from "../events.js";
import type {
  AgentCoordinatorEvent,
  AgentId,
  AgentLifecycleRecord,
  AgentProfile,
  AgentProfileStore,
  AgentRunError,
  AgentRunHistoryStore,
  AgentRunId,
  AgentRunState,
  AgentRunSummary,
  AgentRuntimeFactory,
  CreateAgentProfileInput,
  CreatedManagedAgentRuntime,
  ManagedAgentEvent,
  StartAgentRunInput,
  UpdateAgentProfileInput,
} from "./contracts.js";
import { AgentCoordinatorError } from "./errors.js";
import {
  agentRunSummaryTimestamp,
  BoundedAgentRunHistory,
  isTerminalAgentRunState,
} from "./run-history.js";
import {
  InMemoryWorkspaceWriteLease,
  type WorkspaceWriteLease,
} from "./write-lease.js";

interface ActiveRun {
  readonly id: AgentRunId;
  readonly agentId: AgentId;
  readonly profile: AgentProfile;
  readonly prompt: string;
  readonly attachments: readonly ChatAttachment[];
  state: AgentRunState;
  sessionId?: string;
  startedAt?: string;
  completedAt?: string;
  latestProgress?: string;
  output?: string;
  activeTool?: { readonly callId: string; readonly name: string };
  changedFiles: readonly string[];
  error?: AgentRunError;
  sequence: number;
  controller?: AbortController;
  created?: CreatedManagedAgentRuntime;
  unsubscribe?: () => void;
  ownsWriteLease: boolean;
  cancellationRequested?: boolean;
  execution?: Promise<void>;
  runtimeError?: AgentRunError;
  finishing?: boolean;
}

const maxAgentRunOutputChars = 20_000;

function now(): string {
  return new Date().toISOString();
}

function appendAgentRunOutput(
  current: string | undefined,
  delta: string,
): string {
  const combined = `${current ?? ""}${delta}`;
  if (combined.length <= maxAgentRunOutputChars) return combined;
  return `…${combined.slice(-(maxAgentRunOutputChars - 1))}`;
}

export interface AgentCoordinatorOptions {
  readonly profiles: AgentProfileStore;
  readonly runtimeFactory: AgentRuntimeFactory;
  readonly maxConcurrentRuns?: number;
  readonly writeLease?: WorkspaceWriteLease;
  /** Optional durable history for terminal runs. Defaults to 50 retained runs. */
  readonly history?: AgentRunHistoryStore;
  readonly maxRunHistory?: number;
}

/**
 * Schedules isolated agent runtimes. Initial policy intentionally leases the
 * whole Edit run; hosts can later substitute a finer tool-level lease without
 * changing the client contract.
 */
export class AgentCoordinator {
  readonly events = new EventBus<AgentCoordinatorEvent>();
  private readonly runs = new Map<AgentRunId, ActiveRun>();
  private readonly runsByAgent = new Map<AgentId, AgentRunId>();
  private readonly history: BoundedAgentRunHistory;
  private readonly maxConcurrentRuns: number;
  private readonly maxRunHistory: number;
  private readonly writeLease: WorkspaceWriteLease;
  private queuePump = Promise.resolve();

  constructor(private readonly options: AgentCoordinatorOptions) {
    this.maxConcurrentRuns = options.maxConcurrentRuns ?? 3;
    if (
      !Number.isSafeInteger(this.maxConcurrentRuns) ||
      this.maxConcurrentRuns < 1
    ) {
      throw new Error("maxConcurrentRuns must be a positive integer.");
    }
    this.writeLease = options.writeLease ?? new InMemoryWorkspaceWriteLease();
    this.maxRunHistory = options.maxRunHistory ?? 50;
    if (!Number.isSafeInteger(this.maxRunHistory) || this.maxRunHistory < 1) {
      throw new Error("maxRunHistory must be a positive integer.");
    }
    this.history = new BoundedAgentRunHistory(
      this.maxRunHistory,
      options.history,
    );
  }

  async listProfiles(): Promise<readonly AgentProfile[]> {
    return this.options.profiles.list();
  }

  async getProfile(agentId: AgentId): Promise<AgentProfile | undefined> {
    return this.options.profiles.get(agentId);
  }

  async createProfile(input: CreateAgentProfileInput): Promise<AgentProfile> {
    return this.options.profiles.create(input);
  }

  async updateProfile(
    agentId: AgentId,
    input: UpdateAgentProfileInput,
  ): Promise<AgentProfile> {
    return this.options.profiles.update(agentId, input);
  }

  async deleteProfile(agentId: AgentId): Promise<boolean> {
    if (this.runsByAgent.has(agentId)) {
      throw new AgentCoordinatorError(
        "conflict",
        "Stop the active agent run before deleting its profile.",
      );
    }
    return this.options.profiles.delete(agentId);
  }

  /**
   * Hydrates summaries from an optional host-owned store. A malformed or
   * unavailable history must never keep a client from starting an agent.
   */
  async restoreHistory(): Promise<readonly AgentRunSummary[]> {
    await this.history.restore();
    return this.listRuns();
  }

  listRuns(): readonly AgentRunSummary[] {
    const current = [...this.runs.values()].map((run) => this.summary(run));
    const currentIds = new Set(current.map((run) => run.id));
    return [
      ...current,
      ...this.history.values().filter((run) => !currentIds.has(run.id)),
    ].sort(
      (left, right) =>
        agentRunSummaryTimestamp(right) - agentRunSummaryTimestamp(left),
    );
  }

  getRun(runId: AgentRunId): AgentRunSummary | undefined {
    const run = this.runs.get(runId);
    return run ? this.summary(run) : this.history.get(runId);
  }

  async start(input: StartAgentRunInput): Promise<AgentRunSummary> {
    if (!input.prompt.trim()) {
      throw new AgentCoordinatorError(
        "invalid_profile",
        "An agent run requires a prompt.",
      );
    }
    const profile = await this.options.profiles.get(input.agentId);
    if (!profile) {
      throw new AgentCoordinatorError("not_found", "Unknown agent profile.");
    }
    if (this.runsByAgent.has(profile.id)) {
      throw new AgentCoordinatorError(
        "conflict",
        "This agent already has an active or queued run.",
      );
    }

    const run: ActiveRun = {
      id: randomUUID(),
      agentId: profile.id,
      profile,
      prompt: input.prompt.trim(),
      attachments: input.attachments ?? [],
      state: "queued",
      changedFiles: [],
      sequence: 0,
      ownsWriteLease: false,
    };
    this.history.delete(run.id);
    this.runs.set(run.id, run);
    this.runsByAgent.set(run.agentId, run.id);
    await this.publishRun(run);
    await this.publishLifecycle(run, "queued");
    await this.pump();
    return this.summary(run);
  }

  async stop(runId: AgentRunId): Promise<AgentRunSummary> {
    const run = this.runs.get(runId);
    if (!run) {
      throw new AgentCoordinatorError("not_found", "Unknown agent run.");
    }
    if (isTerminalAgentRunState(run.state)) return this.summary(run);
    if (run.cancellationRequested) return this.summary(run);
    run.cancellationRequested = true;
    run.controller?.abort();
    run.created?.approval?.denyAll();
    if (run.state === "queued") {
      await this.finish(run, "cancelled", {
        code: "aborted",
        message: "Stopped by user.",
      });
    } else {
      // A stop request is observable immediately; ownership remains until launch drains.
      run.state = "running";
      run.activeTool = undefined;
      run.latestProgress = "Stopping…";
      await this.publishRun(run);
    }
    return this.summary(run);
  }

  async stopAll(): Promise<readonly AgentRunSummary[]> {
    const active = [...this.runs.values()].filter(
      (run) => !isTerminalAgentRunState(run.state),
    );
    await Promise.all(active.map((run) => this.stop(run.id)));
    await Promise.all(active.map((run) => run.execution));
    return this.listRuns();
  }

  async resolveApproval(
    runId: AgentRunId,
    callId: string,
    approved: boolean,
  ): Promise<boolean> {
    const run = this.runs.get(runId);
    if (!run || isTerminalAgentRunState(run.state)) return false;
    const resolved = run.created?.approval?.resolve(callId, approved) ?? false;
    if (resolved && run.state === "waiting_for_approval") {
      run.state = "running";
      await this.publishRun(run);
      await this.publishLifecycle(run, "approval_resolved");
    }
    return resolved;
  }

  async dispose(): Promise<void> {
    await this.stopAll();
    await Promise.all([...this.runs.values()].map((run) => run.execution));
  }

  private pump(): Promise<void> {
    const next = this.queuePump.then(() => this.startReadyRuns());
    this.queuePump = next.catch(() => undefined);
    return next;
  }

  private startReadyRuns(): void {
    for (const run of this.runs.values()) {
      if (
        run.state !== "queued" ||
        run.cancellationRequested ||
        this.runningCount() >= this.maxConcurrentRuns
      ) {
        continue;
      }
      if (run.profile.mode === "edit") {
        if (!this.writeLease.tryAcquire(run.id)) continue;
        run.ownsWriteLease = true;
      }
      run.state = "running";
      run.startedAt = now();
      run.controller = new AbortController();
      // Register the whole lifecycle before any observer can await startup.
      // Publications run outside the scheduler pump, so an awaited Stop cannot join itself.
      run.execution = Promise.resolve().then(() => this.launch(run));
    }
  }

  private async launch(run: ActiveRun): Promise<void> {
    let error: AgentRunError | undefined;
    try {
      if (run.ownsWriteLease)
        await this.publishLifecycle(run, "write_lease_acquired");
      if (run.cancellationRequested) return;
      await this.publishRun(run);
      if (run.cancellationRequested) return;
      await this.publishLifecycle(run, "started");
      if (run.cancellationRequested) return;
      await this.options.runtimeFactory.validate(run.profile);
      if (run.cancellationRequested) return;
      const created = await this.options.runtimeFactory.create(run.profile);
      run.created = created;
      if (run.cancellationRequested) return;
      run.unsubscribe = created.events.subscribe((event) =>
        this.handleRuntimeEvent(run, event),
      );
      const session = await created.runtime.createSession();
      if (run.cancellationRequested) return;
      run.sessionId = session.id;
      await this.publishRun(run);
      if (run.cancellationRequested) return;
      await created.runtime.run(
        session.id,
        run.prompt,
        run.controller?.signal,
        [],
        run.attachments,
      );
      error = run.runtimeError;
    } catch (cause) {
      error = {
        code: "runtime_error",
        message: cause instanceof Error ? cause.message : String(cause),
      };
    } finally {
      // Runtime event handlers only record outcomes. Awaited handlers must never await their own run.
      await this.finish(
        run,
        run.cancellationRequested
          ? "cancelled"
          : error
            ? "failed"
            : "completed",
        run.cancellationRequested
          ? { code: "aborted", message: "Stopped by user." }
          : error,
      );
    }
  }

  private async handleRuntimeEvent(
    run: ActiveRun,
    event: RuntimeEvent,
  ): Promise<void> {
    if (isTerminalAgentRunState(run.state) || run.cancellationRequested) return;
    const managed: ManagedAgentEvent = {
      agentId: run.agentId,
      runId: run.id,
      sequence: ++run.sequence,
      occurredAt: now(),
      event,
    };
    await this.events.emit({ type: "runtime", event: managed });
    if (run.cancellationRequested) return;
    if (event.type === "progress_delta") run.latestProgress = event.text;
    if (event.type === "text_delta") {
      run.output = appendAgentRunOutput(run.output, event.text);
    }
    if (event.type === "tool_call_requested") {
      run.activeTool = { callId: event.callId, name: event.tool };
      if (run.profile.approvalPolicy === "ask") {
        run.state = "waiting_for_approval";
        await this.publishLifecycle(run, "waiting_for_approval");
      }
    }
    if (event.type === "tool_completed") {
      run.activeTool = undefined;
      if (run.state === "waiting_for_approval") run.state = "running";
    }
    if (event.type === "run_completed") {
      run.changedFiles = event.modifiedFiles;
      return;
    }
    if (event.type === "run_failed") {
      run.runtimeError = {
        code: "runtime_error",
        message: event.error.message,
      };
      return;
    }
    await this.publishRun(run);
  }

  private async finish(
    run: ActiveRun,
    state: Extract<AgentRunState, "completed" | "failed" | "cancelled">,
    error?: AgentRunError,
  ): Promise<void> {
    if (isTerminalAgentRunState(run.state) || run.finishing) return;
    run.finishing = true;
    run.activeTool = undefined;
    run.unsubscribe?.();
    run.unsubscribe = undefined;

    const created = run.created;
    run.created = undefined;
    run.controller = undefined;
    const cleanupStartedAt = Date.now();
    if (created) await created.dispose().catch(() => undefined);
    const cleanupDurationMs = Date.now() - cleanupStartedAt;
    if (run.ownsWriteLease) {
      this.writeLease.release(run.id);
      run.ownsWriteLease = false;
    }
    this.runsByAgent.delete(run.agentId);
    // Stop remains valid during disposal; choose the outcome only after cleanup settles.
    const finalState = run.cancellationRequested ? "cancelled" : state;
    run.state = finalState;
    run.error = run.cancellationRequested
      ? { code: "aborted", message: "Stopped by user." }
      : error;
    run.completedAt = now();
    await this.publishRun(run);
    await this.publishLifecycle(run, finalState);
    this.history.remember(this.summary(run));
    await this.history.persist();
    this.pruneTerminalRunCache();
    await this.publishLifecycle(run, "cleanup_completed", {
      cleanupDurationMs,
    });
    await this.pump();
  }

  private runningCount(): number {
    return [...this.runs.values()].filter(
      (run) => run.state === "running" || run.state === "waiting_for_approval",
    ).length;
  }

  private pruneTerminalRunCache(): void {
    const terminal = [...this.runs.values()]
      .filter((run) => isTerminalAgentRunState(run.state))
      .sort(
        (left, right) =>
          agentRunSummaryTimestamp(this.summary(right)) -
          agentRunSummaryTimestamp(this.summary(left)),
      );
    for (const run of terminal.slice(this.maxRunHistory)) {
      this.runs.delete(run.id);
    }
  }

  private async publishLifecycle(
    run: ActiveRun,
    phase: AgentLifecycleRecord["phase"],
    details: Pick<AgentLifecycleRecord, "cleanupDurationMs"> = {},
  ): Promise<void> {
    const occurredAt = now();
    const startedAt = run.startedAt ? Date.parse(run.startedAt) : undefined;
    const occurredAtMs = Date.parse(occurredAt);
    const runDurationMs =
      startedAt !== undefined && Number.isFinite(startedAt)
        ? Math.max(0, occurredAtMs - startedAt)
        : undefined;
    await this.events
      .emit({
        type: "lifecycle",
        record: {
          phase,
          runId: run.id,
          agentId: run.agentId,
          state: run.state,
          occurredAt,
          ...(runDurationMs !== undefined ? { runDurationMs } : {}),
          ...(details.cleanupDurationMs !== undefined
            ? { cleanupDurationMs: details.cleanupDurationMs }
            : {}),
          ...(run.error ? { errorCode: run.error.code } : {}),
        },
      })
      .catch(() => undefined);
  }

  private summary(run: ActiveRun): AgentRunSummary {
    return {
      id: run.id,
      agentId: run.agentId,
      ...(run.sessionId ? { sessionId: run.sessionId } : {}),
      state: run.state,
      prompt: run.prompt,
      ...(run.startedAt ? { startedAt: run.startedAt } : {}),
      ...(run.completedAt ? { completedAt: run.completedAt } : {}),
      ...(run.latestProgress ? { latestProgress: run.latestProgress } : {}),
      ...(run.output ? { output: run.output } : {}),
      ...(run.activeTool ? { activeTool: run.activeTool } : {}),
      changedFiles: run.changedFiles,
      ...(run.error ? { error: run.error } : {}),
    };
  }

  private publishRun(run: ActiveRun): Promise<void> {
    return this.events.emit({ type: "run_updated", run: this.summary(run) });
  }
}
