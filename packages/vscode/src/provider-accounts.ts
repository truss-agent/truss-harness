import { randomUUID } from "node:crypto";
import {
  cloudProviderDefinition,
  isCloudProviderId,
  type ModelProviderKind,
} from "@truss-harness/provider-openai-compatible";
import {
  defaultProviderAccountId,
  isProviderAccount,
  type ProviderAccount,
} from "@truss-harness/runtime";
import type * as vscode from "vscode";

export type ProviderAccountState = ProviderAccount & {
  readonly hasCredential: boolean;
};

export class ProviderAccountStore {
  private accountsValue: ProviderAccount[];

  constructor(private readonly context: vscode.ExtensionContext) {
    const stored = context.workspaceState.get("providerAccounts");
    this.accountsValue = Array.isArray(stored)
      ? stored.filter(isProviderAccount)
      : [];
  }

  all(): readonly ProviderAccount[] {
    return this.accountsValue;
  }

  forProvider(provider: ModelProviderKind): readonly ProviderAccount[] {
    return this.accountsValue.filter(
      (account) => account.providerId === provider,
    );
  }

  async ensure(
    provider: ModelProviderKind,
    requestedId?: string,
  ): Promise<ProviderAccount | undefined> {
    if (!isCloudProviderId(provider)) return undefined;
    const requested = requestedId?.trim();
    const existing = requested
      ? this.accountsValue.find(
          (account) =>
            account.id === requested && account.providerId === provider,
        )
      : undefined;
    const account =
      existing ?? (requested ? undefined : this.forProvider(provider)[0]);
    if (account) return account;
    const timestamp = new Date().toISOString();
    const created: ProviderAccount = {
      id: defaultProviderAccountId(provider),
      providerId: provider,
      label: cloudProviderDefinition(provider).label,
      authMethod: "api-key",
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.accountsValue = [...this.accountsValue, created];
    await this.persist();
    const legacy = await this.context.secrets.get(this.legacyKey(provider));
    if (legacy && !(await this.context.secrets.get(this.key(created.id)))) {
      await this.context.secrets.store(this.key(created.id), legacy);
      await this.context.secrets.delete(this.legacyKey(provider));
    }
    return created;
  }

  async apiKey(
    provider: ModelProviderKind,
    reference?: string,
  ): Promise<string | undefined> {
    if (!isCloudProviderId(provider)) return undefined;
    const account = await this.ensure(provider, reference);
    if (account) return this.context.secrets.get(this.key(account.id));
    return this.context.secrets.get(this.legacyKey(provider));
  }

  async storedApiKey(
    provider: ModelProviderKind,
    reference?: string,
  ): Promise<string | undefined> {
    if (!isCloudProviderId(provider)) return undefined;
    const account = reference
      ? this.accountsValue.find(
          (candidate) =>
            candidate.id === reference && candidate.providerId === provider,
        )
      : this.forProvider(provider)[0];
    return account
      ? this.context.secrets.get(this.key(account.id))
      : this.context.secrets.get(this.legacyKey(provider));
  }

  async save(
    provider: ModelProviderKind,
    apiKey: string,
    accountId?: string,
    accountLabel?: string,
  ): Promise<ProviderAccount> {
    if (!isCloudProviderId(provider)) {
      throw new Error("Only cloud providers require an API key.");
    }
    if (!apiKey.trim()) {
      throw new Error("Enter an API key before saving the provider account.");
    }
    const requestedId = accountId?.trim();
    const existing = requestedId
      ? this.accountsValue.find(
          (account) =>
            account.id === requestedId && account.providerId === provider,
        )
      : undefined;
    if (requestedId && !existing) {
      throw new Error("The selected provider account is no longer available.");
    }
    const timestamp = new Date().toISOString();
    const account: ProviderAccount = existing
      ? {
          ...existing,
          label: accountLabel?.trim() || existing.label,
          status: "active",
          updatedAt: timestamp,
        }
      : {
          id: randomUUID(),
          providerId: provider,
          label:
            accountLabel?.trim() ||
            `${cloudProviderDefinition(provider).label} account`,
          authMethod: "api-key",
          status: "active",
          createdAt: timestamp,
          updatedAt: timestamp,
        };
    this.accountsValue = [
      ...this.accountsValue.filter((candidate) => candidate.id !== account.id),
      account,
    ];
    await this.persist();
    await this.context.secrets.store(this.key(account.id), apiKey.trim());
    return account;
  }

  async add(account: ProviderAccount, apiKey: string): Promise<void> {
    this.accountsValue = [
      ...this.accountsValue.filter((candidate) => candidate.id !== account.id),
      account,
    ];
    await this.persist();
    await this.context.secrets.store(this.key(account.id), apiKey.trim());
  }

  async remove(accountId: string): Promise<ProviderAccount> {
    const account = this.accountsValue.find(
      (candidate) => candidate.id === accountId,
    );
    if (!account) {
      throw new Error("The selected provider account is no longer available.");
    }
    await this.context.secrets.delete(this.key(account.id));
    this.accountsValue = this.accountsValue.filter(
      (candidate) => candidate.id !== account.id,
    );
    await this.persist();
    return account;
  }

  async deleteCredential(accountId: string): Promise<void> {
    await this.context.secrets.delete(this.key(accountId));
  }

  async states(): Promise<readonly ProviderAccountState[]> {
    return Promise.all(
      this.accountsValue.map(async (account) => ({
        ...account,
        hasCredential: Boolean(
          (await this.context.secrets.get(this.key(account.id))) ??
            (isCloudProviderId(account.providerId)
              ? await this.context.secrets.get(
                  this.legacyKey(account.providerId),
                )
              : undefined),
        ),
      })),
    );
  }

  private async persist(): Promise<void> {
    await this.context.workspaceState.update(
      "providerAccounts",
      this.accountsValue,
    );
  }

  private key(accountId: string): string {
    return `model-provider-api-key:${accountId}`;
  }

  private legacyKey(provider: ModelProviderKind): string {
    return `model-provider-api-key:${provider}`;
  }
}
