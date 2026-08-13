import { readFile, writeFile } from "node:fs/promises";
import {
  cloudProviderDefinition,
  isCloudProviderId,
} from "@truss-harness/provider-openai-compatible";
import type { ProviderAccount } from "@truss-harness/runtime";
import type { DesktopProvider } from "../shared.js";

export interface CredentialEncryption {
  isAvailable(): boolean;
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
}

export class CredentialService {
  private readonly sessionCredentials = new Map<string, string>();

  constructor(
    private readonly path: () => string,
    private readonly accounts: () => readonly ProviderAccount[],
    private readonly encryption: CredentialEncryption,
  ) {}

  storageKind(): "secure" | "session-only" {
    return this.encryption.isAvailable() ? "secure" : "session-only";
  }

  async migrateLegacy(
    provider: DesktopProvider,
    accountId: string,
  ): Promise<void> {
    if (!isCloudProviderId(provider)) return;
    try {
      const credentials = { ...(await this.read()) };
      if (!credentials[provider] || credentials[accountId]) return;
      credentials[accountId] = credentials[provider];
      delete credentials[provider];
      await this.write(credentials);
    } catch (error) {
      console.warn(
        "Unable to migrate the existing provider credential to its account reference:",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async get(reference: string): Promise<string | undefined> {
    const account = this.accounts().find(
      (candidate) => candidate.id === reference,
    );
    const provider = account?.providerId ?? reference;
    if (!isCloudProviderId(provider)) return undefined;
    const sessionCredential =
      this.sessionCredentials.get(reference) ??
      this.sessionCredentials.get(provider);
    if (sessionCredential) return sessionCredential;
    if (!this.encryption.isAvailable()) return undefined;
    const credentials = await this.read();
    const encoded = credentials[reference] ?? credentials[provider];
    if (!encoded) return undefined;
    try {
      return this.encryption.decrypt(Buffer.from(encoded, "base64"));
    } catch {
      throw new Error(
        `The stored ${cloudProviderDefinition(provider).label} credential could not be decrypted. Remove it and configure the provider again.`,
      );
    }
  }

  async save(
    provider: DesktopProvider,
    accountId: string,
    value: string,
  ): Promise<void> {
    if (!isCloudProviderId(provider)) return;
    if (!this.encryption.isAvailable()) {
      this.sessionCredentials.set(accountId, value);
      return;
    }
    this.sessionCredentials.delete(accountId);
    this.sessionCredentials.delete(provider);
    const credentials = { ...(await this.read()) };
    delete credentials[provider];
    credentials[accountId] = this.encryption.encrypt(value).toString("base64");
    await this.write(credentials);
  }

  async remove(provider: DesktopProvider, accountId?: string): Promise<void> {
    if (!isCloudProviderId(provider)) return;
    if (accountId) this.sessionCredentials.delete(accountId);
    else this.sessionCredentials.delete(provider);
    const remaining = { ...(await this.read()) };
    if (accountId) delete remaining[accountId];
    else {
      delete remaining[provider];
      for (const account of this.accounts())
        if (account.providerId === provider) delete remaining[account.id];
    }
    await this.write(remaining);
  }

  private async read(): Promise<Record<string, string>> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.path(), "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        return {};
      return Object.fromEntries(
        Object.entries(parsed).filter(([, value]) => typeof value === "string"),
      ) as Record<string, string>;
    } catch {
      return {};
    }
  }

  private async write(
    credentials: Readonly<Record<string, string>>,
  ): Promise<void> {
    await writeFile(
      this.path(),
      `${JSON.stringify(credentials, null, 2)}\n`,
      "utf8",
    );
  }
}
