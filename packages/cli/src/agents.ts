import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AgentHost } from "@truss-harness/agent-host";
import {
  ApiKeyCredential,
  AgentCoordinator,
  type AgentProfile,
  type AgentProfileStore,
  type AgentRunSummary,
  type CreateAgentProfileInput,
  type CredentialProvider,
  type ToolApproval,
  type ToolCall,
} from "@truss-harness/runtime";
import { isCloudProviderId } from "@truss-harness/provider-openai-compatible";
import type { ClientConfiguration } from "./runtime.js";

const profilesFileName = "agents.json";

export function agentProfilesPath(workspaceRoot: string): string {
  return join(workspaceRoot, ".truss-harness", profilesFileName);
}

function validProfile(value: unknown): value is AgentProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Partial<AgentProfile>;
  return (
    typeof profile.id === "string" &&
    typeof profile.displayName === "string" &&
    Boolean(
      profile.provider &&
        typeof profile.provider.providerId === "string" &&
        typeof profile.provider.modelId === "string",
    ) &&
    (profile.mode === "chat" ||
      profile.mode === "plan" ||
      profile.mode === "edit") &&
    (profile.approvalPolicy === "ask" ||
      profile.approvalPolicy === "auto-read" ||
      profile.approvalPolicy === "auto-all") &&
    typeof profile.internetAccess === "boolean" &&
    typeof profile.createdAt === "string" &&
    typeof profile.updatedAt === "string"
  );
}

/** Workspace-local profile storage. Credentials remain in environment/host storage. */
export class FileAgentProfileStore implements AgentProfileStore {
  constructor(private readonly workspaceRoot: string) {}

  async list(): Promise<readonly AgentProfile[]> {
    try {
      const parsed: unknown = JSON.parse(
        await readFile(agentProfilesPath(this.workspaceRoot), "utf8"),
      );
      return Array.isArray(parsed) ? parsed.filter(validProfile) : [];
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return [];
      throw new Error(
        `Unable to read agent profiles: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
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
    const now = new Date().toISOString();
    const profile: AgentProfile = {
      id: randomUUID(),
      displayName: input.displayName.trim(),
      ...(input.instructions?.trim()
        ? { instructions: input.instructions.trim() }
        : {}),
      provider: input.provider,
      mode: input.mode ?? "chat",
      approvalPolicy: input.approvalPolicy ?? "auto-read",
      internetAccess: input.internetAccess ?? false,
      createdAt: now,
      updatedAt: now,
    };
    await this.save([...(await this.list()), profile]);
    return profile;
  }

  async update(
    id: string,
    input: Partial<CreateAgentProfileInput>,
  ): Promise<AgentProfile> {
    const current = await this.get(id);
    if (!current) throw new Error("Unknown agent profile.");
    const next: AgentProfile = {
      ...current,
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
    if (
      !next.displayName ||
      !next.provider.providerId ||
      !next.provider.modelId
    )
      throw new Error("An agent needs a name, provider, and model.");
    await this.save(
      (await this.list()).map((profile) =>
        profile.id === id ? next : profile,
      ),
    );
    return next;
  }

  async delete(id: string): Promise<boolean> {
    const profiles = await this.list();
    if (!profiles.some((profile) => profile.id === id)) return false;
    await this.save(profiles.filter((profile) => profile.id !== id));
    return true;
  }

  private async save(profiles: readonly AgentProfile[]): Promise<void> {
    const path = agentProfilesPath(this.workspaceRoot);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(profiles, null, 2)}\n`, "utf8");
  }
}

function approval(profile: AgentProfile): ToolApproval {
  return {
    async approve(call: ToolCall): Promise<boolean> {
      const readOnly = [
        "read_file",
        "list_directory",
        "search_files",
        "grep",
      ].includes(call.name);
      return (
        profile.approvalPolicy === "auto-all" ||
        (profile.approvalPolicy === "auto-read" && readOnly)
      );
    },
  };
}

export function createCliAgentCoordinator(
  configuration: ClientConfiguration,
  profiles = new FileAgentProfileStore(configuration.workspaceRoot),
): AgentCoordinator {
  const credential: CredentialProvider | undefined =
    configuration.credential ??
    (configuration.apiKey
      ? new ApiKeyCredential("cli-agent-credential", configuration.apiKey)
      : undefined);
  const host = new AgentHost({
    workspaceRoot: configuration.workspaceRoot,
    mcpServers: configuration.mcpServers,
    credentialResolver: {
      async resolve(reference) {
        return reference === "configuration" ? credential : undefined;
      },
    },
    approvalFactory: approval,
  });
  return new AgentCoordinator({
    profiles,
    runtimeFactory: host.createRuntimeFactory(),
  });
}

export function profileFromConfiguration(
  configuration: ClientConfiguration,
  displayName: string,
): CreateAgentProfileInput {
  return {
    displayName,
    provider: {
      providerId: configuration.provider,
      endpointUrl: configuration.baseUrl,
      modelId: configuration.model,
      ...(isCloudProviderId(configuration.provider)
        ? { credentialRef: "configuration" }
        : {}),
    },
    mode: configuration.mode ?? "chat",
    approvalPolicy: "auto-read",
    internetAccess: configuration.internetAccess ?? false,
  };
}

export async function waitForAgentRun(
  coordinator: AgentCoordinator,
  runId: string,
  onUpdate: (run: AgentRunSummary) => void,
): Promise<AgentRunSummary> {
  const initial = coordinator.getRun(runId);
  if (!initial) throw new Error("Unknown agent run.");
  onUpdate(initial);
  if (["completed", "failed", "cancelled"].includes(initial.state))
    return initial;
  return new Promise((resolve) => {
    const unsubscribe = coordinator.events.subscribe((event) => {
      if (event.type !== "run_updated" || event.run.id !== runId) return;
      onUpdate(event.run);
      if (["completed", "failed", "cancelled"].includes(event.run.state)) {
        unsubscribe();
        resolve(event.run);
      }
    });
  });
}
