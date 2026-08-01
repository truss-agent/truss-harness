import { randomUUID } from "node:crypto";

/** Stable identity for a provider account, never the credential itself. */
export type ProviderAccountId = string;

/** Authentication mechanisms a provider adapter may expose. */
export type ProviderAuthMethod =
  | "api-key"
  | "oauth2"
  | "device-code"
  | "environment"
  | "external-cli";

export type ProviderAccountStatus = "active" | "reauth-required" | "disabled";

/**
 * Persisted account metadata. Secrets, access tokens, refresh tokens, and
 * environment values must stay behind a CredentialProvider implementation.
 */
export interface ProviderAccount {
  readonly id: ProviderAccountId;
  readonly providerId: string;
  readonly label: string;
  readonly authMethod: ProviderAuthMethod;
  readonly status: ProviderAccountStatus;
  readonly scopes?: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateProviderAccountInput {
  readonly providerId: string;
  readonly label: string;
  readonly authMethod: ProviderAuthMethod;
  readonly scopes?: readonly string[];
}

export interface UpdateProviderAccountInput {
  readonly label?: string;
  readonly status?: ProviderAccountStatus;
  readonly scopes?: readonly string[];
}

/** Client-owned persistence for non-secret account metadata. */
export interface ProviderAccountStore {
  list(providerId?: string): Promise<readonly ProviderAccount[]>;
  get(id: ProviderAccountId): Promise<ProviderAccount | undefined>;
  create(input: CreateProviderAccountInput): Promise<ProviderAccount>;
  update(
    id: ProviderAccountId,
    input: UpdateProviderAccountInput,
  ): Promise<ProviderAccount>;
  delete(id: ProviderAccountId): Promise<boolean>;
}

/** Deterministic account ID used when migrating an existing provider key. */
export function defaultProviderAccountId(
  providerId: string,
): ProviderAccountId {
  const normalized = providerId.trim();
  if (!normalized) throw new Error("A provider account requires a provider.");
  return `provider:${encodeURIComponent(normalized)}:default`;
}

export function isProviderAuthMethod(
  value: unknown,
): value is ProviderAuthMethod {
  return (
    value === "api-key" ||
    value === "oauth2" ||
    value === "device-code" ||
    value === "environment" ||
    value === "external-cli"
  );
}

export function isProviderAccountStatus(
  value: unknown,
): value is ProviderAccountStatus {
  return (
    value === "active" || value === "reauth-required" || value === "disabled"
  );
}

export function isProviderAccount(value: unknown): value is ProviderAccount {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<ProviderAccount>;
  return (
    typeof candidate.id === "string" &&
    Boolean(candidate.id.trim()) &&
    typeof candidate.providerId === "string" &&
    Boolean(candidate.providerId.trim()) &&
    typeof candidate.label === "string" &&
    Boolean(candidate.label.trim()) &&
    isProviderAuthMethod(candidate.authMethod) &&
    isProviderAccountStatus(candidate.status) &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string" &&
    (candidate.scopes === undefined ||
      (Array.isArray(candidate.scopes) &&
        candidate.scopes.every((scope) => typeof scope === "string")))
  );
}

function validateCreateInput(input: CreateProviderAccountInput): void {
  if (!input.providerId.trim())
    throw new Error("A provider account requires a provider.");
  if (!input.label.trim())
    throw new Error("A provider account requires a label.");
  if (!isProviderAuthMethod(input.authMethod))
    throw new Error("A provider account has an unsupported auth method.");
}

function validateUpdateInput(input: UpdateProviderAccountInput): void {
  if (input.label !== undefined && !input.label.trim())
    throw new Error("A provider account requires a label.");
  if (input.status !== undefined && !isProviderAccountStatus(input.status))
    throw new Error("A provider account has an unsupported status.");
}

/** Small reference implementation for tests and hosts without durable storage. */
export class InMemoryProviderAccountStore implements ProviderAccountStore {
  private readonly accounts = new Map<ProviderAccountId, ProviderAccount>();

  async list(providerId?: string): Promise<readonly ProviderAccount[]> {
    return [...this.accounts.values()].filter(
      (account) => !providerId || account.providerId === providerId,
    );
  }

  async get(id: ProviderAccountId): Promise<ProviderAccount | undefined> {
    return this.accounts.get(id);
  }

  async create(input: CreateProviderAccountInput): Promise<ProviderAccount> {
    validateCreateInput(input);
    const timestamp = new Date().toISOString();
    const account: ProviderAccount = {
      id: randomUUID(),
      providerId: input.providerId.trim(),
      label: input.label.trim(),
      authMethod: input.authMethod,
      status: "active",
      ...(input.scopes?.length ? { scopes: [...new Set(input.scopes)] } : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.accounts.set(account.id, account);
    return account;
  }

  async update(
    id: ProviderAccountId,
    input: UpdateProviderAccountInput,
  ): Promise<ProviderAccount> {
    validateUpdateInput(input);
    const existing = this.accounts.get(id);
    if (!existing) throw new Error("Unknown provider account.");
    const account: ProviderAccount = {
      ...existing,
      ...(input.label !== undefined ? { label: input.label.trim() } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.scopes !== undefined
        ? { scopes: [...new Set(input.scopes)] }
        : {}),
      updatedAt: new Date().toISOString(),
    };
    this.accounts.set(id, account);
    return account;
  }

  async delete(id: ProviderAccountId): Promise<boolean> {
    return this.accounts.delete(id);
  }
}
