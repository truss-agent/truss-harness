import { randomUUID } from "node:crypto";
import type {
  AgentApprovalPolicy,
  AgentId,
  AgentProfile,
  AgentProfileStore,
  AgentProviderBinding,
  CreateAgentProfileInput,
  ManagedAgentMode,
  UpdateAgentProfileInput,
} from "./contracts.js";
import { AgentCoordinatorError } from "./errors.js";

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
  if (!binding.providerId.trim()) {
    throw new AgentCoordinatorError(
      "invalid_profile",
      "An agent profile requires a provider.",
    );
  }
  if (!binding.modelId.trim()) {
    throw new AgentCoordinatorError(
      "invalid_profile",
      "An agent profile requires a model.",
    );
  }
  if (binding.endpointUrl !== undefined && !binding.endpointUrl.trim()) {
    throw new AgentCoordinatorError(
      "invalid_profile",
      "An agent endpoint cannot be empty.",
    );
  }
  if (binding.credentialRef !== undefined && !binding.credentialRef.trim()) {
    throw new AgentCoordinatorError(
      "invalid_profile",
      "An agent credential reference cannot be empty.",
    );
  }
}

function validateProfileInput(
  input: CreateAgentProfileInput | UpdateAgentProfileInput,
): void {
  if (input.displayName !== undefined && !input.displayName.trim()) {
    throw new AgentCoordinatorError(
      "invalid_profile",
      "An agent profile requires a display name.",
    );
  }
  if (input.provider) validateProvider(input.provider);
  if (input.mode !== undefined && !isMode(input.mode)) {
    throw new AgentCoordinatorError(
      "invalid_profile",
      "An agent profile has an unsupported mode.",
    );
  }
  if (
    input.approvalPolicy !== undefined &&
    !isApprovalPolicy(input.approvalPolicy)
  ) {
    throw new AgentCoordinatorError(
      "invalid_profile",
      "An agent profile has an unsupported approval policy.",
    );
  }
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
    if (!existing) {
      throw new AgentCoordinatorError("not_found", "Unknown agent profile.");
    }
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
      updatedAt: now(),
    };
    this.profiles.set(id, profile);
    return profile;
  }

  async delete(id: AgentId): Promise<boolean> {
    return this.profiles.delete(id);
  }
}
