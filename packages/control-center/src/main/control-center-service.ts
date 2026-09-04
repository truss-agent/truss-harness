import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { AgentHost } from "@truss-harness/agent-host";
import {
  AgentCoordinator,
  type AgentProfile,
  type AgentProfileStore,
  type CreateAgentProfileInput,
  type UpdateAgentProfileInput,
} from "@truss-harness/runtime";
import type {
  ControlAgent,
  ControlSnapshot,
  ControlWorkspace,
  CreateControlAgentInput,
} from "../shared.js";
import {
  discoverControlLocalEndpoints,
  discoverControlModels,
} from "./model-discovery.js";

interface StoredState {
  readonly workspaces: readonly ControlWorkspace[];
  readonly agents: readonly ControlAgent[];
}

/** Coordinates independent runtime hosts. Every workspace owns its own write lease. */
export class ControlCenterService {
  private state: StoredState = { workspaces: [], agents: [] };
  private readonly coordinators = new Map<string, AgentCoordinator>();
  private readonly unsubscribers = new Map<string, () => void>();
  private readonly listeners = new Set<(snapshot: ControlSnapshot) => void>();

  constructor(private readonly statePath: string) {}

  async load(): Promise<void> {
    try {
      const value = JSON.parse(
        await readFile(this.statePath, "utf8"),
      ) as Partial<StoredState>;
      this.state = {
        workspaces: Array.isArray(value.workspaces)
          ? value.workspaces.filter(isWorkspace)
          : [],
        agents: Array.isArray(value.agents) ? value.agents.filter(isAgent) : [],
      };
    } catch {
      /* First launch has no state. */
    }
    await Promise.all(
      this.state.workspaces.map((workspace) =>
        this.configureWorkspace(workspace),
      ),
    );
  }

  subscribe(listener: (snapshot: ControlSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async snapshot(): Promise<ControlSnapshot> {
    return {
      workspaces: this.state.workspaces,
      agents: this.state.agents,
      runs: this.state.workspaces.flatMap((workspace) =>
        (this.coordinators.get(workspace.id)?.listRuns() ?? []).map((run) => ({
          ...run,
          workspaceId: workspace.id,
        })),
      ),
    };
  }
  async addWorkspace(root: string): Promise<ControlSnapshot> {
    const normalized = root.trim();
    if (!normalized) throw new Error("Choose a folder to add it.");
    if (
      this.state.workspaces.some((workspace) => workspace.root === normalized)
    )
      throw new Error("That folder is already in the control center.");
    const workspace = {
      id: randomUUID(),
      root: normalized,
      name: basename(normalized) || normalized,
    };
    this.state = {
      ...this.state,
      workspaces: [...this.state.workspaces, workspace],
    };
    await this.configureWorkspace(workspace);
    await this.persist();
    return this.publish();
  }
  discoverLocalEndpoints() {
    return discoverControlLocalEndpoints();
  }
  discoverLocalModels(
    providerId: "ollama" | "openai-compatible" | "llama-cpp",
    endpointUrl: string,
  ) {
    return discoverControlModels(providerId, endpointUrl);
  }
  async removeWorkspace(id: string): Promise<ControlSnapshot> {
    const coordinator = this.requireCoordinator(id);
    if (
      coordinator
        .listRuns()
        .some((run) =>
          ["queued", "running", "waiting_for_approval"].includes(run.state),
        )
    )
      throw new Error(
        "Stop this workspace's active agents before removing it.",
      );
    await coordinator.dispose();
    this.unsubscribers.get(id)?.();
    this.coordinators.delete(id);
    this.unsubscribers.delete(id);
    this.state = {
      workspaces: this.state.workspaces.filter(
        (workspace) => workspace.id !== id,
      ),
      agents: this.state.agents.filter((agent) => agent.workspaceId !== id),
    };
    await this.persist();
    return this.publish();
  }
  async createAgent(input: CreateControlAgentInput): Promise<ControlSnapshot> {
    const workspace = this.state.workspaces.find(
      (item) => item.id === input.workspaceId,
    );
    if (!workspace) throw new Error("Choose a workspace for this agent.");
    await this.requireCoordinator(workspace.id).createProfile(input);
    return this.publish();
  }
  async deleteAgent(id: string): Promise<ControlSnapshot> {
    const agent = this.requireAgent(id);
    await this.requireCoordinator(agent.workspaceId).deleteProfile(id);
    return this.publish();
  }
  async startAgent(id: string, prompt: string): Promise<ControlSnapshot> {
    const agent = this.requireAgent(id);
    await this.requireCoordinator(agent.workspaceId).start({
      agentId: id,
      prompt,
    });
    return this.publish();
  }
  async stopAgent(runId: string): Promise<ControlSnapshot> {
    const coordinator = this.findCoordinatorByRun(runId);
    await coordinator.stop(runId);
    return this.publish();
  }
  async resolveApproval(
    runId: string,
    callId: string,
    approved: boolean,
  ): Promise<ControlSnapshot> {
    await this.findCoordinatorByRun(runId).resolveApproval(
      runId,
      callId,
      approved,
    );
    return this.publish();
  }
  async dispose(): Promise<void> {
    await Promise.all(
      [...this.coordinators.values()].map((coordinator) =>
        coordinator.dispose(),
      ),
    );
    for (const unsubscribe of this.unsubscribers.values()) unsubscribe();
  }

  private async configureWorkspace(workspace: ControlWorkspace): Promise<void> {
    const host = new AgentHost({
      workspaceRoot: workspace.root,
      approvalFactory: createApproval,
    });
    const coordinator = new AgentCoordinator({
      profiles: new WorkspaceProfileStore(
        workspace.id,
        () => this.state.agents,
        (agents) => {
          this.state = { ...this.state, agents };
          return this.persist();
        },
      ),
      runtimeFactory: host.createRuntimeFactory(),
    });
    this.coordinators.set(workspace.id, coordinator);
    this.unsubscribers.set(
      workspace.id,
      coordinator.events.subscribe(() => {
        void this.publish();
      }),
    );
  }
  private requireCoordinator(id: string): AgentCoordinator {
    const value = this.coordinators.get(id);
    if (!value) throw new Error("That workspace is unavailable.");
    return value;
  }
  private requireAgent(id: string): ControlAgent {
    const value = this.state.agents.find((agent) => agent.id === id);
    if (!value) throw new Error("Unknown agent.");
    return value;
  }
  private findCoordinatorByRun(runId: string): AgentCoordinator {
    const value = [...this.coordinators.values()].find((coordinator) =>
      coordinator.getRun(runId),
    );
    if (!value) throw new Error("Unknown agent run.");
    return value;
  }
  private async persist(): Promise<void> {
    await mkdir(dirname(this.statePath), { recursive: true });
    const temporary = `${this.statePath}.next`;
    await writeFile(
      temporary,
      `${JSON.stringify(this.state, null, 2)}\n`,
      "utf8",
    );
    await rename(temporary, this.statePath);
  }
  private async publish(): Promise<ControlSnapshot> {
    const snapshot = await this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
    return snapshot;
  }
}

class WorkspaceProfileStore implements AgentProfileStore {
  constructor(
    private readonly workspaceId: string,
    private readonly all: () => readonly ControlAgent[],
    private readonly replace: (
      agents: readonly ControlAgent[],
    ) => Promise<void>,
  ) {}
  async list(): Promise<readonly AgentProfile[]> {
    return this.all().filter((agent) => agent.workspaceId === this.workspaceId);
  }
  async get(id: string): Promise<AgentProfile | undefined> {
    return (await this.list()).find((agent) => agent.id === id);
  }
  async create(input: CreateAgentProfileInput): Promise<AgentProfile> {
    if (
      !input.displayName.trim() ||
      !input.provider.providerId.trim() ||
      !input.provider.modelId.trim()
    )
      throw new Error("An agent needs a name, provider, and model.");
    const now = new Date().toISOString();
    const agent: ControlAgent = {
      id: randomUUID(),
      workspaceId: this.workspaceId,
      displayName: input.displayName.trim(),
      provider: input.provider,
      mode: input.mode ?? "edit",
      approvalPolicy: input.approvalPolicy ?? "ask",
      internetAccess: input.internetAccess ?? false,
      createdAt: now,
      updatedAt: now,
      ...(input.instructions?.trim()
        ? { instructions: input.instructions.trim() }
        : {}),
    };
    await this.replace([...this.all(), agent]);
    return agent;
  }
  async update(
    _id: string,
    _input: UpdateAgentProfileInput,
  ): Promise<AgentProfile> {
    throw new Error(
      "Editing profiles is not in this preview yet. Create a replacement agent instead.",
    );
  }
  async delete(id: string): Promise<boolean> {
    if (!this.all().some((agent) => agent.id === id)) return false;
    await this.replace(this.all().filter((agent) => agent.id !== id));
    return true;
  }
}
function createApproval(profile: AgentProfile) {
  const waiting = new Map<string, (approved: boolean) => void>();
  return {
    approve(call: { readonly id: string; readonly name: string }) {
      const readable = [
        "read_file",
        "list_directory",
        "search_files",
        "grep",
      ].includes(call.name);
      if (
        profile.approvalPolicy === "auto-all" ||
        (profile.approvalPolicy === "auto-read" && readable)
      )
        return Promise.resolve(true);
      return new Promise<boolean>((resolve) => waiting.set(call.id, resolve));
    },
    resolve(id: string, approved: boolean) {
      const resolve = waiting.get(id);
      if (!resolve) return false;
      waiting.delete(id);
      resolve(approved);
      return true;
    },
    denyAll() {
      for (const resolve of waiting.values()) resolve(false);
      waiting.clear();
    },
  };
}
function isWorkspace(value: unknown): value is ControlWorkspace {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as ControlWorkspace).id === "string" &&
      typeof (value as ControlWorkspace).root === "string" &&
      typeof (value as ControlWorkspace).name === "string",
  );
}
function isAgent(value: unknown): value is ControlAgent {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as ControlAgent).id === "string" &&
      typeof (value as ControlAgent).workspaceId === "string" &&
      typeof (value as ControlAgent).displayName === "string" &&
      (value as ControlAgent).provider,
  );
}
