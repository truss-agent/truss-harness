import { describe, expect, it } from "vitest";
import {
  AgentCoordinator,
  AgentCoordinatorError,
  EventBus,
  InMemoryAgentProfileStore,
  InMemoryWorkspaceWriteLease,
  type AgentProfile,
  type AgentRunHistoryStore,
  type AgentRunSummary,
  type AgentRuntimeFactory,
  type CreatedManagedAgentRuntime,
  type RuntimeEvent,
} from "./index.js";

class Deferred {
  readonly promise: Promise<void>;
  private resolvePromise!: () => void;

  constructor() {
    this.promise = new Promise<void>((resolve) => {
      this.resolvePromise = resolve;
    });
  }
  resolve(): void {
    this.resolvePromise();
  }
}

class FakeRuntime {
  private sessionNumber = 0;
  readonly started = new Deferred();

  constructor(
    private readonly events: EventBus<RuntimeEvent>,
    private readonly gate: Deferred,
  ) {}

  async createSession() {
    this.sessionNumber += 1;
    const timestamp = new Date();
    return {
      id: `session-${this.sessionNumber}`,
      createdAt: timestamp,
      updatedAt: timestamp,
      messages: [],
    };
  }

  async run(
    sessionId: string,
    _prompt: string,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.events.emit({ type: "run_started", sessionId });
    await this.events.emit({
      type: "progress_delta",
      sessionId,
      text: "Inspecting workspace",
    });
    this.started.resolve();
    await Promise.race([
      this.gate.promise,
      new Promise<void>((_resolve, reject) =>
        signal?.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        }),
      ),
    ]);
    await this.events.emit({
      type: "run_completed",
      sessionId,
      modifiedFiles: [],
    });
  }
}

class FakeFactory implements AgentRuntimeFactory {
  readonly created: string[] = [];
  readonly runtimes = new Map<string, FakeRuntime>();
  readonly gates = new Map<string, Deferred>();

  async validate(_profile: AgentProfile): Promise<void> {}

  async create(profile: AgentProfile): Promise<CreatedManagedAgentRuntime> {
    this.created.push(profile.id);
    const events = new EventBus<RuntimeEvent>();
    const gate = new Deferred();
    const runtime = new FakeRuntime(events, gate);
    this.gates.set(profile.id, gate);
    this.runtimes.set(profile.id, runtime);
    return { runtime, events, async dispose() {} };
  }
}

class InMemoryAgentRunHistoryStore implements AgentRunHistoryStore {
  runs: readonly AgentRunSummary[] = [];

  async load(): Promise<readonly AgentRunSummary[]> {
    return this.runs;
  }

  async save(runs: readonly AgentRunSummary[]): Promise<void> {
    this.runs = [...runs];
  }
}

async function waitFor(
  predicate: () => boolean,
  message: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(message);
}

async function createProfile(
  store: InMemoryAgentProfileStore,
  name: string,
  mode: "chat" | "plan" | "edit" = "plan",
): Promise<AgentProfile> {
  return store.create({
    displayName: name,
    mode,
    provider: { providerId: "fake", modelId: "fake-model" },
  });
}

describe("AgentCoordinator", () => {
  it("runs independent read-only agents concurrently and correlates their events", async () => {
    const profiles = new InMemoryAgentProfileStore();
    const factory = new FakeFactory();
    const coordinator = new AgentCoordinator({
      profiles,
      runtimeFactory: factory,
      maxConcurrentRuns: 2,
    });
    const first = await createProfile(profiles, "Research");
    const second = await createProfile(profiles, "Review");
    const events: Array<{ readonly runId: string; readonly sequence: number }> =
      [];
    coordinator.events.subscribe((event) => {
      if (event.type === "runtime")
        events.push({
          runId: event.event.runId,
          sequence: event.event.sequence,
        });
    });

    const firstRun = await coordinator.start({
      agentId: first.id,
      prompt: "Inspect the workspace",
    });
    const secondRun = await coordinator.start({
      agentId: second.id,
      prompt: "Review the diff",
    });
    await waitFor(
      () => factory.created.length === 2,
      "both Plan agents should start",
    );
    await waitFor(
      () => events.filter((event) => event.runId === firstRun.id).length >= 2,
      "first agent events should be correlated",
    );
    await waitFor(
      () => events.filter((event) => event.runId === secondRun.id).length >= 2,
      "second agent events should be correlated",
    );

    expect(coordinator.getRun(firstRun.id)?.state).toBe("running");
    expect(coordinator.getRun(secondRun.id)?.state).toBe("running");
    expect(
      events
        .filter((event) => event.runId === firstRun.id)
        .map((event) => event.sequence),
    ).toEqual([1, 2]);
    expect(
      events
        .filter((event) => event.runId === secondRun.id)
        .map((event) => event.sequence),
    ).toEqual([1, 2]);

    factory.gates.get(first.id)?.resolve();
    factory.gates.get(second.id)?.resolve();
    await waitFor(
      () =>
        coordinator.getRun(firstRun.id)?.state === "completed" &&
        coordinator.getRun(secondRun.id)?.state === "completed",
      "both agents should complete",
    );
  });

  it("queues a second edit agent until the workspace write lease is released", async () => {
    const profiles = new InMemoryAgentProfileStore();
    const factory = new FakeFactory();
    const lease = new InMemoryWorkspaceWriteLease();
    const coordinator = new AgentCoordinator({
      profiles,
      runtimeFactory: factory,
      maxConcurrentRuns: 3,
      writeLease: lease,
    });
    const first = await createProfile(profiles, "Implementer A", "edit");
    const second = await createProfile(profiles, "Implementer B", "edit");

    const firstRun = await coordinator.start({
      agentId: first.id,
      prompt: "Update the first file",
    });
    await waitFor(
      () => coordinator.getRun(firstRun.id)?.state === "running",
      "first edit agent should start",
    );
    expect(lease.holder()).toBe(firstRun.id);

    const secondRun = await coordinator.start({
      agentId: second.id,
      prompt: "Update the second file",
    });
    expect(coordinator.getRun(secondRun.id)?.state).toBe("queued");
    expect(factory.created).toEqual([first.id]);

    factory.gates.get(first.id)?.resolve();
    await waitFor(
      () => coordinator.getRun(firstRun.id)?.state === "completed",
      "first edit agent should complete",
    );
    await waitFor(
      () => coordinator.getRun(secondRun.id)?.state === "running",
      "second edit agent should start after the lease is released",
    );
    expect(lease.holder()).toBe(secondRun.id);

    factory.gates.get(second.id)?.resolve();
    await waitFor(
      () => coordinator.getRun(secondRun.id)?.state === "completed",
      "second edit agent should complete",
    );
    expect(lease.holder()).toBeUndefined();
  });

  it("cancels queued work without creating a runtime and protects active profiles from deletion", async () => {
    const profiles = new InMemoryAgentProfileStore();
    const factory = new FakeFactory();
    const lease = new InMemoryWorkspaceWriteLease();
    const coordinator = new AgentCoordinator({
      profiles,
      runtimeFactory: factory,
      writeLease: lease,
    });
    const first = await createProfile(profiles, "Writer A", "edit");
    const second = await createProfile(profiles, "Writer B", "edit");
    const firstRun = await coordinator.start({
      agentId: first.id,
      prompt: "Edit one",
    });
    await waitFor(
      () => coordinator.getRun(firstRun.id)?.state === "running",
      "first writer should start",
    );
    const secondRun = await coordinator.start({
      agentId: second.id,
      prompt: "Edit two",
    });

    await expect(coordinator.deleteProfile(first.id)).rejects.toMatchObject({
      code: "conflict",
    } satisfies Partial<AgentCoordinatorError>);
    await coordinator.stop(secondRun.id);
    expect(coordinator.getRun(secondRun.id)?.state).toBe("cancelled");
    expect(factory.created).toEqual([first.id]);

    await coordinator.stop(firstRun.id);
    expect(lease.holder()).toBeUndefined();
    await expect(coordinator.deleteProfile(first.id)).resolves.toBe(true);
  });

  it("persists and restores only the newest bounded terminal run history", async () => {
    const profiles = new InMemoryAgentProfileStore();
    const history = new InMemoryAgentRunHistoryStore();
    const factory = new FakeFactory();
    const coordinator = new AgentCoordinator({
      profiles,
      runtimeFactory: factory,
      history,
      maxRunHistory: 1,
    });
    const profile = await createProfile(profiles, "Research");
    const run = await coordinator.start({
      agentId: profile.id,
      prompt: "Inspect the workspace",
    });
    await waitFor(
      () => coordinator.getRun(run.id)?.state === "running",
      "agent should start before it completes",
    );
    factory.gates.get(profile.id)?.resolve();
    await waitFor(
      () => coordinator.getRun(run.id)?.state === "completed",
      "agent should complete before its run is saved",
    );

    const newerRun = await coordinator.start({
      agentId: profile.id,
      prompt: "Review the diff",
    });
    await waitFor(
      () => coordinator.getRun(newerRun.id)?.state === "running",
      "second agent run should start after the first completes",
    );
    factory.gates.get(profile.id)?.resolve();
    await waitFor(
      () => coordinator.getRun(newerRun.id)?.state === "completed",
      "second agent run should complete before history is restored",
    );

    expect(history.runs).toHaveLength(1);
    expect(history.runs[0]).toMatchObject({
      id: newerRun.id,
      agentId: profile.id,
      state: "completed",
      prompt: "Review the diff",
    });

    const restored = new AgentCoordinator({
      profiles,
      runtimeFactory: new FakeFactory(),
      history,
      maxRunHistory: 1,
    });
    await restored.restoreHistory();

    expect(restored.getRun(run.id)).toBeUndefined();
    expect(restored.getRun(newerRun.id)).toMatchObject({
      id: newerRun.id,
      state: "completed",
    });
    expect(restored.listRuns()).toHaveLength(1);
  });
});
