import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  AgentHost,
  type ProviderConnectionResult,
} from "@truss-harness/agent-host";
import { brand } from "@truss-harness/branding";
import { FileAgentRunHistoryStore } from "@truss-harness/cli/agents";
import { isCloudProviderId } from "@truss-harness/provider-openai-compatible";
import {
  AgentCoordinator,
  type AgentProfile,
  type AgentProfileStore,
  ApiKeyCredential,
  type CreateAgentProfileInput,
  FileWorkspacePlanStore,
  type ToolApproval,
  type ToolCall,
  type UpdateAgentProfileInput,
} from "@truss-harness/runtime";
import type {
  DesktopAgentsSnapshot,
  DesktopConfiguration,
  DesktopEvent,
  DesktopState,
} from "../shared.js";

export class ManagedAgentService {
  private host: AgentHost | undefined;
  private coordinatorValue: AgentCoordinator | undefined;
  private unsubscribeEvents: (() => void) | undefined;

  constructor(
    private readonly state: () => DesktopState,
    private readonly setState: (state: DesktopState) => void,
    private readonly persist: () => Promise<void>,
    private readonly credential: (
      reference: string,
    ) => Promise<string | undefined>,
    private readonly send: (event: DesktopEvent) => void,
  ) {}

  get coordinator(): AgentCoordinator | undefined {
    return this.coordinatorValue;
  }

  async configure(): Promise<void> {
    this.unsubscribeEvents?.();
    this.unsubscribeEvents = undefined;
    await this.coordinatorValue?.dispose();
    const state = this.state();
    this.host = new AgentHost({
      workspaceRoot: state.workspaceRoot,
      mcpServers: state.configuration?.mcpServers,
      credentialResolver: {
        resolve: async (reference) => {
          const account = state.providerAccounts?.find(
            (candidate) => candidate.id === reference,
          );
          const provider = account?.providerId ?? reference;
          if (!isCloudProviderId(provider)) return undefined;
          const value = await this.credential(reference);
          return value
            ? new ApiKeyCredential(`desktop:${provider}:${reference}`, value)
            : undefined;
        },
      },
      approvalFactory: createAgentApproval,
      planStoreFactory: (profile) =>
        new FileWorkspacePlanStore(
          state.workspaceRoot,
          managedAgentPlanPath(state.workspaceRoot, profile.id),
        ),
    });
    this.coordinatorValue = new AgentCoordinator({
      profiles: new DesktopAgentProfileStore(
        this.state,
        this.setState,
        this.persist,
      ),
      runtimeFactory: this.host.createRuntimeFactory(),
      history: new FileAgentRunHistoryStore(state.workspaceRoot),
    });
    await this.coordinatorValue.restoreHistory();
    this.unsubscribeEvents = this.coordinatorValue.events.subscribe(() => {
      void this.publish();
    });
  }

  async dispose(): Promise<void> {
    this.unsubscribeEvents?.();
    this.unsubscribeEvents = undefined;
    await this.coordinatorValue?.dispose();
    this.coordinatorValue = undefined;
    this.host = undefined;
  }

  async snapshot(): Promise<DesktopAgentsSnapshot> {
    return {
      profiles: this.coordinatorValue
        ? await this.coordinatorValue.listProfiles()
        : (this.state().agentProfiles ?? []),
      runs: this.coordinatorValue?.listRuns() ?? [],
    };
  }

  async publish(): Promise<DesktopAgentsSnapshot> {
    const snapshot = await this.snapshot();
    this.send({ type: "agents", snapshot });
    return snapshot;
  }

  async create(input: CreateAgentProfileInput): Promise<DesktopAgentsSnapshot> {
    const coordinator = this.requireCoordinator();
    if (!this.host) throw new Error("The agent host is not ready.");
    await this.host.validateProfile({
      id: "validation",
      displayName: input.displayName,
      provider: input.provider,
      mode: input.mode ?? "chat",
      approvalPolicy: input.approvalPolicy ?? "ask",
      internetAccess: input.internetAccess ?? false,
      createdAt: "",
      updatedAt: "",
    });
    await coordinator.createProfile(input);
    return this.publish();
  }

  async update(
    id: string,
    input: UpdateAgentProfileInput,
  ): Promise<DesktopAgentsSnapshot> {
    await this.requireCoordinator().updateProfile(id, input);
    return this.publish();
  }

  async delete(id: string): Promise<DesktopAgentsSnapshot> {
    await this.requireCoordinator().deleteProfile(id);
    return this.publish();
  }

  async start(id: string, prompt: string): Promise<DesktopAgentsSnapshot> {
    if (!prompt.trim())
      throw new Error("Enter a focused task before starting an agent.");
    await this.requireCoordinator().start({
      agentId: id,
      prompt: prompt.trim(),
    });
    return this.publish();
  }

  async stop(runId: string): Promise<DesktopAgentsSnapshot> {
    await this.requireCoordinator().stop(runId);
    return this.publish();
  }

  async stopAll(): Promise<DesktopAgentsSnapshot> {
    await this.requireCoordinator().stopAll();
    return this.publish();
  }

  async resolveApproval(
    runId: string,
    callId: string,
    approved: boolean,
  ): Promise<DesktopAgentsSnapshot> {
    await this.requireCoordinator().resolveApproval(runId, callId, approved);
    return this.publish();
  }

  async testProviderConnection(
    configuration: DesktopConfiguration,
    credential?: ApiKeyCredential,
  ): Promise<ProviderConnectionResult> {
    if (!this.host) await this.configure();
    const host = this.host;
    if (!host) throw new Error("The agent host is not ready.");
    return host.testProviderConnection(
      {
        providerId: configuration.provider,
        endpointUrl: configuration.baseUrl,
        modelId: configuration.model,
        ...(isCloudProviderId(configuration.provider)
          ? {
              credentialRef:
                configuration.credentialAccountId ?? configuration.provider,
            }
          : {}),
      },
      undefined,
      credential,
    );
  }

  private requireCoordinator(): AgentCoordinator {
    if (!this.coordinatorValue) throw new Error("The agent host is not ready.");
    return this.coordinatorValue;
  }
}

class DesktopAgentProfileStore implements AgentProfileStore {
  constructor(
    private readonly state: () => DesktopState,
    private readonly setState: (state: DesktopState) => void,
    private readonly persist: () => Promise<void>,
  ) {}

  async list(): Promise<readonly AgentProfile[]> {
    return this.state().agentProfiles ?? [];
  }

  async get(id: string): Promise<AgentProfile | undefined> {
    return (await this.list()).find((profile) => profile.id === id);
  }

  async create(input: CreateAgentProfileInput): Promise<AgentProfile> {
    if (
      !input.displayName.trim() ||
      !input.provider.providerId.trim() ||
      !input.provider.modelId.trim()
    )
      throw new Error("An agent needs a name, provider, and model.");
    const timestamp = new Date().toISOString();
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
    this.setState({
      ...this.state(),
      agentProfiles: [...(this.state().agentProfiles ?? []), profile],
    });
    await this.persist();
    return profile;
  }

  async update(
    id: string,
    input: UpdateAgentProfileInput,
  ): Promise<AgentProfile> {
    const existing = await this.get(id);
    if (!existing) throw new Error("Unknown agent profile.");
    if (input.displayName !== undefined && !input.displayName.trim())
      throw new Error("An agent needs a name.");
    if (
      input.provider &&
      (!input.provider.providerId.trim() || !input.provider.modelId.trim())
    )
      throw new Error("An agent needs a provider and model.");
    const profile: AgentProfile = {
      ...existing,
      ...(input.displayName !== undefined
        ? { displayName: input.displayName.trim() }
        : {}),
      ...(input.instructions !== undefined
        ? input.instructions.trim()
          ? { instructions: input.instructions.trim() }
          : { instructions: undefined }
        : {}),
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.mode ? { mode: input.mode } : {}),
      ...(input.approvalPolicy ? { approvalPolicy: input.approvalPolicy } : {}),
      ...(input.internetAccess !== undefined
        ? { internetAccess: input.internetAccess }
        : {}),
      updatedAt: new Date().toISOString(),
    };
    this.setState({
      ...this.state(),
      agentProfiles: (this.state().agentProfiles ?? []).map((candidate) =>
        candidate.id === id ? profile : candidate,
      ),
    });
    await this.persist();
    return profile;
  }

  async delete(id: string): Promise<boolean> {
    const profiles = this.state().agentProfiles ?? [];
    if (!profiles.some((profile) => profile.id === id)) return false;
    this.setState({
      ...this.state(),
      agentProfiles: profiles.filter((profile) => profile.id !== id),
    });
    await this.persist();
    return true;
  }
}

export function createAgentApproval(profile: AgentProfile): ToolApproval & {
  resolve(callId: string, approved: boolean): boolean;
  denyAll(): void;
} {
  const pending = new Map<string, (approved: boolean) => void>();
  return {
    approve(call: ToolCall): Promise<boolean> {
      const readOnly = [
        "read_file",
        "list_directory",
        "search_files",
        "grep",
      ].includes(call.name);
      if (
        profile.approvalPolicy === "auto-all" ||
        (profile.approvalPolicy === "auto-read" && readOnly)
      )
        return Promise.resolve(true);
      return new Promise((resolveApproval) =>
        pending.set(call.id, resolveApproval),
      );
    },
    resolve(callId: string, approved: boolean): boolean {
      const resolveApproval = pending.get(callId);
      if (!resolveApproval) return false;
      pending.delete(callId);
      resolveApproval(approved);
      return true;
    },
    denyAll(): void {
      for (const resolveApproval of pending.values()) resolveApproval(false);
      pending.clear();
    },
  };
}

export function managedAgentPlanPath(
  workspaceRoot: string,
  agentId: string,
): string {
  const profileKey = createHash("sha256")
    .update(agentId)
    .digest("hex")
    .slice(0, 24);
  return join(
    workspaceRoot,
    brand.workspaceDirectory,
    "agents",
    profileKey,
    "plans",
    "active.json",
  );
}
