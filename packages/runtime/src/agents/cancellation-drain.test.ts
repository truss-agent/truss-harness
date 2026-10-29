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
