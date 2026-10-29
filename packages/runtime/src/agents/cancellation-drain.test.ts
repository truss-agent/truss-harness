import { expect, it } from "vitest";
import {
  AgentCoordinator,
  EventBus,
  InMemoryAgentProfileStore,
  InMemoryWorkspaceWriteLease,
  type RuntimeEvent,
  type AgentRuntimeFactory,
} from "../index.js";
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
it("holds the writer lease through cancellation drain and terminal event handlers", async () => {
  const profiles = new InMemoryAgentProfileStore();
  const first = await profiles.create({
    displayName: "first",
    mode: "edit",
    provider: { providerId: "test", modelId: "test" },
  });
  const second = await profiles.create({
    displayName: "second",
    mode: "edit",
    provider: { providerId: "test", modelId: "test" },
  });
  const gate = deferred();
  const started = deferred();
  const secondStarted = deferred();
  const lease = new InMemoryWorkspaceWriteLease();
  let settled = false;
  let overlap = false;
  const factory: AgentRuntimeFactory = {
    async validate() {},
    async create(profile) {
      const events = new EventBus<RuntimeEvent>();
      return {
        events,
        async dispose() {},
        runtime: {
          async createSession() {
            return {
              id: profile.id,
              messages: [],
              createdAt: new Date(),
              updatedAt: new Date(),
            };
          },
          async run(sessionId) {
            if (profile.id === first.id) {
              started.resolve();
              await gate.promise;
              settled = true;
            } else {
              overlap = !settled;
              secondStarted.resolve();
            }
            await events.emit({
              type: "run_completed",
              sessionId,
              modifiedFiles: [],
            });
          },
        },
      };
    },
  };
  const coordinator = new AgentCoordinator({
    profiles,
    runtimeFactory: factory,
    writeLease: lease,
  });
  const run = await coordinator.start({ agentId: first.id, prompt: "first" });
  await started.promise;
  const queued = await coordinator.start({
    agentId: second.id,
    prompt: "second",
  });
  await coordinator.stop(run.id);
  expect(lease.holder()).toBe(run.id);
  expect(coordinator.getRun(queued.id)?.state).toBe("queued");
  gate.resolve();
  await secondStarted.promise;
  expect(overlap).toBe(false);
  // A completion event is awaited by runtime.run; drain must never await that same run from its handler.
  await expect(coordinator.stopAll()).resolves.toBeDefined();
});
it("drains runtime creation and disposal before releasing a stopped writer", async () => {
  const profiles = new InMemoryAgentProfileStore();
  const profile = await profiles.create({
    displayName: "writer",
    mode: "edit",
    provider: { providerId: "test", modelId: "test" },
  });
  const creating = deferred();
  const created = deferred();
  const disposing = deferred();
  const disposed = deferred();
  const lease = new InMemoryWorkspaceWriteLease();
  let runs = 0;
  const factory: AgentRuntimeFactory = {
    async validate() {},
    async create() {
      creating.resolve();
      await created.promise;
      return {
        events: new EventBus<RuntimeEvent>(),
        runtime: {
          async createSession() {
            throw new Error("cancelled creation must not allocate a session");
          },
          async run() {
            runs++;
          },
        },
        async dispose() {
          disposing.resolve();
          await disposed.promise;
        },
      };
    },
  };
  const coordinator = new AgentCoordinator({
    profiles,
    runtimeFactory: factory,
    writeLease: lease,
  });
  const run = await coordinator.start({ agentId: profile.id, prompt: "write" });
  await creating.promise;
  await coordinator.stop(run.id);
  await coordinator.stop(run.id);
  let drained = false;
  const shutdown = coordinator.dispose().then(() => {
    drained = true;
  });
  expect(coordinator.getRun(run.id)).toMatchObject({
    state: "running",
    latestProgress: "Stopping…",
  });
  expect(lease.holder()).toBe(run.id);
  created.resolve();
  await disposing.promise;
  expect(drained).toBe(false);
  expect(lease.holder()).toBe(run.id);
  disposed.resolve();
  await shutdown;
  expect(lease.holder()).toBeUndefined();
  expect(coordinator.getRun(run.id)?.state).toBe("cancelled");
  expect(runs).toBe(0);
});
it("permits Stop from an awaited runtime event without restoring approval state", async () => {
  const profiles = new InMemoryAgentProfileStore();
  const profile = await profiles.create({
    displayName: "writer",
    mode: "edit",
    approvalPolicy: "ask",
    provider: { providerId: "test", modelId: "test" },
  });
  const waiting = deferred();
  const gate = deferred();
  const factory: AgentRuntimeFactory = {
    async validate() {},
    async create() {
      const events = new EventBus<RuntimeEvent>();
      return {
        events,
        async dispose() {},
        runtime: {
          async createSession() {
            return {
              id: "s",
              messages: [],
              createdAt: new Date(),
              updatedAt: new Date(),
            };
          },
          async run(sessionId) {
            await events.emit({
              type: "tool_call_requested",
              sessionId,
              callId: "call",
              tool: "write_file",
              input: {},
            });
            waiting.resolve();
            await gate.promise;
          },
        },
      };
    },
  };
  const coordinator = new AgentCoordinator({
    profiles,
    runtimeFactory: factory,
  });
  coordinator.events.subscribe(async (event) => {
    if (
      event.type === "runtime" &&
      event.event.event.type === "tool_call_requested"
    )
      await coordinator.stop(event.event.runId);
  });
  const run = await coordinator.start({ agentId: profile.id, prompt: "write" });
  await waiting.promise;
  expect(coordinator.getRun(run.id)).toMatchObject({
    state: "running",
    latestProgress: "Stopping…",
  });
  gate.resolve();
  await coordinator.dispose();
  expect(coordinator.getRun(run.id)?.state).toBe("cancelled");
});

it.each(["stopAll", "dispose"] as const)(
  "%s waits for a blocked startup publication before releasing ownership",
  async (shutdownMethod) => {
    const profiles = new InMemoryAgentProfileStore();
    const profile = await profiles.create({
      displayName: "writer",
      mode: "edit",
      provider: { providerId: "test", modelId: "test" },
    });
    const publishing = deferred();
    const published = deferred();
    const stopping = deferred();
    const lease = new InMemoryWorkspaceWriteLease();
    let executions = 0;
    let first = true;
    const factory: AgentRuntimeFactory = {
      async validate() {},
      async create() {
        return {
          events: new EventBus<RuntimeEvent>(),
          async dispose() {},
          runtime: {
            async createSession() {
              return {
                id: "s",
                messages: [],
                createdAt: new Date(),
                updatedAt: new Date(),
              };
            },
            async run() {
              executions++;
            },
          },
        };
      },
    };
    const coordinator = new AgentCoordinator({
      profiles,
      runtimeFactory: factory,
      writeLease: lease,
    });
    coordinator.events.subscribe(async (event) => {
      if (event.type !== "run_updated") return;
      if (event.run.latestProgress === "Stopping…") stopping.resolve();
      if (event.run.state === "running" && first) {
        first = false;
        publishing.resolve();
        await published.promise;
      }
    });
    const starting = coordinator.start({ agentId: profile.id, prompt: "work" });
    await publishing.promise;
    let drained = false;
    const shutdown = coordinator[shutdownMethod]().then(() => {
      drained = true;
    });
    await stopping.promise;
    await new Promise<void>((resolve) => setImmediate(resolve));
    try {
      expect(drained).toBe(false);
      expect(lease.holder()).toBeTruthy();
    } finally {
      published.resolve();
      await starting;
      await shutdown;
      await coordinator.dispose();
    }
    expect(lease.holder()).toBeUndefined();
    expect(coordinator.listRuns()[0]?.state).toBe("cancelled");
    expect(executions).toBe(0);
  },
);

it("permits awaited Stop in the write_lease_acquired lifecycle callback", async () => {
  const profiles = new InMemoryAgentProfileStore();
  const profile = await profiles.create({
    displayName: "writer",
    mode: "edit",
    provider: { providerId: "test", modelId: "test" },
  });
  const lease = new InMemoryWorkspaceWriteLease();
  let executions = 0;
  const factory: AgentRuntimeFactory = {
    async validate() {},
    async create() {
      return {
        events: new EventBus<RuntimeEvent>(),
        async dispose() {},
        runtime: {
          async createSession() {
            return {
              id: "s",
              messages: [],
              createdAt: new Date(),
              updatedAt: new Date(),
            };
          },
          async run() {
            executions++;
          },
        },
      };
    },
  };
  const coordinator = new AgentCoordinator({
    profiles,
    runtimeFactory: factory,
    writeLease: lease,
  });
  const stopped = deferred();
  coordinator.events.subscribe(async (event) => {
    if (
      event.type === "lifecycle" &&
      event.record.phase === "write_lease_acquired"
    ) {
      await coordinator.stop(event.record.runId);
      stopped.resolve();
    }
  });
  const starting = coordinator.start({ agentId: profile.id, prompt: "work" });
  await Promise.race([
    Promise.all([starting, stopped.promise]),
    new Promise<never>((_, reject) =>
      setImmediate(() =>
        reject(new Error("Awaited lease Stop deadlocked the scheduler")),
      ),
    ),
  ]);
  await coordinator.dispose();
  expect(lease.holder()).toBeUndefined();
  expect(coordinator.listRuns()[0]?.state).toBe("cancelled");
  expect(executions).toBe(0);
});

it.each(["completed", "failed"] as const)(
  "Stop during disposal overrides the earlier %s outcome in events and history",
  async (outcome) => {
    const profiles = new InMemoryAgentProfileStore();
    const profile = await profiles.create({
      displayName: "writer",
      mode: "edit",
      provider: { providerId: "test", modelId: "test" },
    });
    const disposing = deferred();
    const disposed = deferred();
    const lease = new InMemoryWorkspaceWriteLease();
    const savedStates: string[] = [];
    const terminalStates: string[] = [];
    const factory: AgentRuntimeFactory = {
      async validate() {},
      async create() {
        return {
          events: new EventBus<RuntimeEvent>(),
          async dispose() {
            disposing.resolve();
            await disposed.promise;
          },
          runtime: {
            async createSession() {
              return {
                id: "s",
                messages: [],
                createdAt: new Date(),
                updatedAt: new Date(),
              };
            },
            async run() {
              if (outcome === "failed") throw new Error("execution failure");
            },
          },
        };
      },
    };
    const coordinator = new AgentCoordinator({
      profiles,
      runtimeFactory: factory,
      writeLease: lease,
      history: {
        async load() {
          return [];
        },
        async save(runs) {
          savedStates.push(...runs.map((run) => run.state));
        },
      },
    });
    coordinator.events.subscribe((event) => {
      if (
        event.type === "lifecycle" &&
        ["completed", "failed", "cancelled"].includes(event.record.phase)
      )
        terminalStates.push(event.record.phase);
    });
    const run = await coordinator.start({
      agentId: profile.id,
      prompt: "work",
    });
    await disposing.promise;
    const stopped = await coordinator.stop(run.id);
    expect(stopped).toMatchObject({
      state: "running",
      latestProgress: "Stopping…",
    });
    expect(lease.holder()).toBe(run.id);
    disposed.resolve();
    await coordinator.dispose();
    expect(coordinator.getRun(run.id)).toMatchObject({
      state: "cancelled",
      error: { code: "aborted" },
    });
    expect(terminalStates).toEqual(["cancelled"]);
    expect(savedStates).toEqual(["cancelled"]);
    expect(lease.holder()).toBeUndefined();
  },
);
