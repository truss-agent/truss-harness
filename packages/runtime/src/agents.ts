import { randomUUID } from "node:crypto";
import type {
  ChatAttachment,
  JsonObject,
  RuntimeEvent,
  Session,
} from "./contracts.js";
import { EventBus, type EventListener } from "./events.js";

/** A stable profile identity, independent from a provider session ID. */
export type AgentId = string;
/** A single execution of an agent profile. */
export type AgentRunId = string;

export type ManagedAgentMode = "chat" | "plan" | "edit";
export type AgentApprovalPolicy = "ask" | "auto-read" | "auto-all";
export type AgentRunState =
  | "idle"
  | "queued"
  | "running"
  | "waiting_for_approval"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * A provider-neutral model selection. Hosts resolve this binding through their
 * own provider registry; the runtime never imports a concrete adapter.
 */
export interface AgentProviderBinding {
  readonly providerId: string;
  readonly endpointId?: string;
  readonly endpointUrl?: string;
  readonly modelId: string;
  /** Opaque secure-storage key. It is never a credential value. */
  readonly credentialRef?: string;
  readonly options?: JsonObject;
}

export interface AgentProfile {
  readonly id: AgentId;
  readonly displayName: string;
  readonly instructions?: string;
  readonly provider: AgentProviderBinding;
  readonly mode: ManagedAgentMode;
  readonly approvalPolicy: AgentApprovalPolicy;
  readonly internetAccess: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateAgentProfileInput {
  readonly displayName: string;
  readonly instructions?: string;
  readonly provider: AgentProviderBinding;
  readonly mode?: ManagedAgentMode;
  readonly approvalPolicy?: AgentApprovalPolicy;
  readonly internetAccess?: boolean;
}

export interface UpdateAgentProfileInput {
  readonly displayName?: string;
  readonly instructions?: string;
  readonly provider?: AgentProviderBinding;
  readonly mode?: ManagedAgentMode;
  readonly approvalPolicy?: AgentApprovalPolicy;
  readonly internetAccess?: boolean;
}

export interface AgentRunError {
  readonly code:
    | "aborted"
    | "conflict"
    | "invalid_profile"
    | "provider_unavailable"
    | "runtime_error";
  readonly message: string;
}

export interface AgentRunSummary {
  readonly id: AgentRunId;
  readonly agentId: AgentId;
  readonly sessionId?: string;
  readonly state: AgentRunState;
  readonly prompt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly latestProgress?: string;
  readonly activeTool?: { readonly callId: string; readonly name: string };
  readonly changedFiles: readonly string[];
  readonly error?: AgentRunError;
}

export interface ManagedAgentEvent {
  readonly agentId: AgentId;
  readonly runId: AgentRunId;
  /** Monotonic within one run. */
  readonly sequence: number;
  readonly occurredAt: string;
  readonly event: RuntimeEvent;
}

export type AgentCoordinatorEvent =
  | { readonly type: "run_updated"; readonly run: AgentRunSummary }
  | { readonly type: "runtime"; readonly event: ManagedAgentEvent };

export interface AgentProfileStore {
  list(): Promise<readonly AgentProfile[]>;
  get(id: AgentId): Promise<AgentProfile | undefined>;
  create(input: CreateAgentProfileInput): Promise<AgentProfile>;
  update(id: AgentId, input: UpdateAgentProfileInput): Promise<AgentProfile>;
  delete(id: AgentId): Promise<boolean>;
}

/** A minimal runtime surface the coordinator needs. */
export interface ManagedAgentRuntime {
  createSession(
    messages?: readonly import("./contracts.js").ChatMessage[],
  ): Promise<Session>;
  run(
    sessionId: string,
    prompt: string,
    signal?: AbortSignal,
    requestContext?: readonly import("./context.js").ContextBlock[],
    attachments?: readonly ChatAttachment[],
  ): Promise<void>;
}

export interface AgentApprovalController {
  resolve(callId: string, approved: boolean): boolean;
  denyAll(): void;
}

export interface CreatedManagedAgentRuntime {
  readonly runtime: ManagedAgentRuntime;
  readonly events: {
    subscribe(listener: EventListener<RuntimeEvent>): () => void;
  };
  readonly approval?: AgentApprovalController;
  dispose(): Promise<void>;
}

/** Implemented by a host that knows provider adapters, tools, credentials, and MCP. */
export interface AgentRuntimeFactory {
  validate(profile: AgentProfile): Promise<void>;
  create(profile: AgentProfile): Promise<CreatedManagedAgentRuntime>;
}

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

export class AgentCoordinatorError extends Error {
  constructor(
    readonly code: "conflict" | "invalid_profile" | "not_found",
    message: string,
  ) {
    super(message);
    this.name = "AgentCoordinatorError";
  }
}

function now(): string {
  return new Date().toISOString();
}

function isMode(value: unknown): value is ManagedAgentMode {
  return value === "chat" || value === "plan" || value === "edit";
}

function isApprovalPolicy(value: unknown): value is AgentApprovalPolicy {
  return value === "ask" || value === "auto-read" || value === "auto-all";
}

function validateProvider(binding: AgentProviderBinding): void {
  if (!binding.providerId.trim())
    throw new AgentCoordinatorError(
      "invalid_profile",
      "An agent profile requires a provider.",
    );
  if (!binding.modelId.trim())
    throw new AgentCoordinatorError(
      "invalid_profile",
      "An agent profile requires a model.",
    );
  if (binding.endpointUrl !== undefined && !binding.endpointUrl.trim())
    throw new AgentCoordinatorError(
      "invalid_profile",
      "An agent endpoint cannot be empty.",
    );
  if (binding.credentialRef !== undefined && !binding.credentialRef.trim())
    throw new AgentCoordinatorError(
      "invalid_profile",
      "An agent credential reference cannot be empty.",
    );
}

function validateProfileInput(
  input: CreateAgentProfileInput | UpdateAgentProfileInput,
): void {
  if (input.displayName !== undefined && !input.displayName.trim())
    throw new AgentCoordinatorError(
      "invalid_profile",
      "An agent profile requires a display name.",
    );
  if (input.provider) validateProvider(input.provider);
  if (input.mode !== undefined && !isMode(input.mode))
    throw new AgentCoordinatorError(
      "invalid_profile",
      "An agent profile has an unsupported mode.",
    );
  if (
    input.approvalPolicy !== undefined &&
    !isApprovalPolicy(input.approvalPolicy)
  )
    throw new AgentCoordinatorError(
      "invalid_profile",
      "An agent profile has an unsupported approval policy.",
    );
}

/** Replaceable in-memory store used by tests and hosts that do not need persistence yet. */
export class InMemoryAgentProfileStore implements AgentProfileStore {
  private readonly profiles = new Map<AgentId, AgentProfile>();

  async list(): Promise<readonly AgentProfile[]> {
    return [...this.profiles.values()];
  }
  async get(id: AgentId): Promise<AgentProfile | undefined> {
    return this.profiles.get(id);
  }

  async create(input: CreateAgentProfileInput): Promise<AgentProfile> {
    validateProfileInput(input);
    const timestamp = now();
    const profile: AgentProfile = {
      id: randomUUID(),
      displayName: input.displayName.trim(),
      ...(input.instructions?.trim()
        ? { instructions: input.instructions.trim() }
        : {}),
      provider: input.provider,
      mode: input.mode ?? "chat",
      approvalPolicy: input.approvalPolicy ?? "ask",
      internetAccess: input.internetAccess ?? false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.profiles.set(profile.id, profile);
    return profile;
  }

  async update(
    id: AgentId,
    input: UpdateAgentProfileInput,
  ): Promise<AgentProfile> {
    validateProfileInput(input);
    const existing = this.profiles.get(id);
    if (!existing)
      throw new AgentCoordinatorError("not_found", "Unknown agent profile.");
    const profile: AgentProfile = {
      ...existing,
      ...(input.displayName !== undefined
        ? { displayName: input.displayName.trim() }
        : {}),
      ...(input.instructions !== undefined
        ? {
            ...(input.instructions.trim()
              ? { instructions: input.instructions.trim() }
              : { instructions: undefined }),
          }
        : {}),
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.mode ? { mode: input.mode } : {}),
      ...(input.approvalPolicy ? { approvalPolicy: input.approvalPolicy } : {}),
      ...(input.internetAccess !== undefined
        ? { internetAccess: input.internetAccess }
        : {}),
      updatedAt: now(),
    };
    this.profiles.set(id, profile);
    return profile;
  }

  async delete(id: AgentId): Promise<boolean> {
    return this.profiles.delete(id);
  }
}

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
  activeTool?: { readonly callId: string; readonly name: string };
  changedFiles: readonly string[];
  error?: AgentRunError;
  sequence: number;
  controller?: AbortController;
  created?: CreatedManagedAgentRuntime;
  unsubscribe?: () => void;
  ownsWriteLease: boolean;
}

export interface StartAgentRunInput {
  readonly agentId: AgentId;
  readonly prompt: string;
  readonly attachments?: readonly ChatAttachment[];
}

export interface AgentCoordinatorOptions {
  readonly profiles: AgentProfileStore;
  readonly runtimeFactory: AgentRuntimeFactory;
  readonly maxConcurrentRuns?: number;
  readonly writeLease?: WorkspaceWriteLease;
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
  private readonly maxConcurrentRuns: number;
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
    if (this.runsByAgent.has(agentId))
      throw new AgentCoordinatorError(
        "conflict",
        "Stop the active agent run before deleting its profile.",
      );
    return this.options.profiles.delete(agentId);
  }

  listRuns(): readonly AgentRunSummary[] {
    return [...this.runs.values()].map((run) => this.summary(run));
  }
  getRun(runId: AgentRunId): AgentRunSummary | undefined {
    const run = this.runs.get(runId);
    return run ? this.summary(run) : undefined;
  }

  async start(input: StartAgentRunInput): Promise<AgentRunSummary> {
    if (!input.prompt.trim())
      throw new AgentCoordinatorError(
        "invalid_profile",
        "An agent run requires a prompt.",
      );
    const profile = await this.options.profiles.get(input.agentId);
    if (!profile)
      throw new AgentCoordinatorError("not_found", "Unknown agent profile.");
    if (this.runsByAgent.has(profile.id))
      throw new AgentCoordinatorError(
        "conflict",
        "This agent already has an active or queued run.",
      );

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
    this.runs.set(run.id, run);
    this.runsByAgent.set(run.agentId, run.id);
    await this.publishRun(run);
    await this.pump();
    return this.summary(run);
  }

  async stop(runId: AgentRunId): Promise<AgentRunSummary> {
    const run = this.runs.get(runId);
    if (!run)
      throw new AgentCoordinatorError("not_found", "Unknown agent run.");
    if (this.isTerminal(run.state)) return this.summary(run);
    run.controller?.abort();
    run.created?.approval?.denyAll();
    await this.finish(run, "cancelled", {
      code: "aborted",
      message: "Stopped by user.",
    });
    return this.summary(run);
  }

  async stopAll(): Promise<readonly AgentRunSummary[]> {
    const active = [...this.runs.values()].filter(
      (run) => !this.isTerminal(run.state),
    );
    await Promise.all(active.map((run) => this.stop(run.id)));
    return this.listRuns();
  }

  async resolveApproval(
    runId: AgentRunId,
    callId: string,
    approved: boolean,
  ): Promise<boolean> {
    const run = this.runs.get(runId);
    if (!run || this.isTerminal(run.state)) return false;
    const resolved = run.created?.approval?.resolve(callId, approved) ?? false;
    if (resolved && run.state === "waiting_for_approval") {
      run.state = "running";
      await this.publishRun(run);
    }
    return resolved;
  }

  async dispose(): Promise<void> {
    await this.stopAll();
  }

  private pump(): Promise<void> {
    const next = this.queuePump.then(() => this.startReadyRuns());
    this.queuePump = next.catch(() => undefined);
    return next;
  }

  private async startReadyRuns(): Promise<void> {
    for (const run of this.runs.values()) {
      if (
        run.state !== "queued" ||
        this.runningCount() >= this.maxConcurrentRuns
      )
        continue;
      if (run.profile.mode === "edit") {
        if (!this.writeLease.tryAcquire(run.id)) continue;
        run.ownsWriteLease = true;
      }
      run.state = "running";
      run.startedAt = now();
      await this.publishRun(run);
      void this.launch(run);
    }
  }

  private async launch(run: ActiveRun): Promise<void> {
    try {
      await this.options.runtimeFactory.validate(run.profile);
      if (this.isTerminal(run.state)) return;
      const created = await this.options.runtimeFactory.create(run.profile);
      if (this.isTerminal(run.state)) {
        await created.dispose();
        return;
      }
      run.created = created;
      run.unsubscribe = created.events.subscribe((event) =>
        this.handleRuntimeEvent(run, event),
      );
      const session = await created.runtime.createSession();
      run.sessionId = session.id;
      run.controller = new AbortController();
      await this.publishRun(run);
      await created.runtime.run(
        session.id,
        run.prompt,
        run.controller.signal,
        [],
        run.attachments,
      );
      if (!this.isTerminal(run.state)) await this.finish(run, "completed");
    } catch (error) {
      if (!this.isTerminal(run.state)) {
        const message = error instanceof Error ? error.message : String(error);
        await this.finish(run, "failed", { code: "runtime_error", message });
      }
    }
  }

  private async handleRuntimeEvent(
    run: ActiveRun,
    event: RuntimeEvent,
  ): Promise<void> {
    if (this.isTerminal(run.state)) return;
    const managed: ManagedAgentEvent = {
      agentId: run.agentId,
      runId: run.id,
      sequence: ++run.sequence,
      occurredAt: now(),
      event,
    };
    await this.events.emit({ type: "runtime", event: managed });
    if (event.type === "progress_delta") run.latestProgress = event.text;
    if (event.type === "tool_call_requested") {
      run.activeTool = { callId: event.callId, name: event.tool };
      if (run.profile.approvalPolicy === "ask")
        run.state = "waiting_for_approval";
    }
    if (event.type === "tool_completed") {
      run.activeTool = undefined;
      if (run.state === "waiting_for_approval") run.state = "running";
    }
    if (event.type === "run_completed") {
      run.changedFiles = event.modifiedFiles;
      await this.finish(run, "completed");
      return;
    }
    if (event.type === "run_failed") {
      await this.finish(run, "failed", {
        code: "runtime_error",
        message: event.error.message,
      });
      return;
    }
    await this.publishRun(run);
  }

  private async finish(
    run: ActiveRun,
    state: Extract<AgentRunState, "completed" | "failed" | "cancelled">,
    error?: AgentRunError,
  ): Promise<void> {
    if (this.isTerminal(run.state)) return;
    run.state = state;
    run.error = error;
    run.completedAt = now();
    run.activeTool = undefined;
    run.unsubscribe?.();
    run.unsubscribe = undefined;
    if (run.ownsWriteLease) {
      this.writeLease.release(run.id);
      run.ownsWriteLease = false;
    }
    this.runsByAgent.delete(run.agentId);
    const created = run.created;
    run.created = undefined;
    run.controller = undefined;
    if (created) await created.dispose().catch(() => undefined);
    await this.publishRun(run);
    await this.pump();
  }

  private runningCount(): number {
    return [...this.runs.values()].filter(
      (run) => run.state === "running" || run.state === "waiting_for_approval",
    ).length;
  }

  private isTerminal(state: AgentRunState): boolean {
    return state === "completed" || state === "failed" || state === "cancelled";
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
      ...(run.activeTool ? { activeTool: run.activeTool } : {}),
      changedFiles: run.changedFiles,
      ...(run.error ? { error: run.error } : {}),
    };
  }

  private publishRun(run: ActiveRun): Promise<void> {
    return this.events.emit({ type: "run_updated", run: this.summary(run) });
  }
}
