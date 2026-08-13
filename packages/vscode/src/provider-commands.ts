import { randomUUID } from "node:crypto";
import { brand } from "@truss-harness/branding";
import { cloudProviderDefinitions } from "@truss-harness/provider-openai-compatible";
import type { ProviderAccount } from "@truss-harness/runtime";
import * as vscode from "vscode";
import type { ModelConfiguration } from "./contracts.js";
import type { ProviderAccountStore } from "./provider-accounts.js";

export interface ProviderCommandControllerOptions {
  readonly accounts: ProviderAccountStore;
  readonly configuration: () => ModelConfiguration;
  readonly applyConfiguration: (
    configuration: ModelConfiguration,
  ) => Promise<void>;
  readonly resetRuntime: () => Promise<void>;
  readonly showConnectionResult: () => Promise<void>;
}

export class ProviderCommandController {
  constructor(private readonly options: ProviderCommandControllerOptions) {}

  register(): readonly vscode.Disposable[] {
    return [
      vscode.commands.registerCommand(
        "trussHarness.testProviderConnection",
        () =>
          this.options
            .showConnectionResult()
            .catch((error: unknown) =>
              vscode.window.showErrorMessage(
                error instanceof Error ? error.message : String(error),
              ),
            ),
      ),
      vscode.commands.registerCommand(
        "trussHarness.configureByokProvider",
        () => this.configure(),
      ),
      vscode.commands.registerCommand("trussHarness.removeByokCredential", () =>
        this.removeCredential(),
      ),
    ];
  }

  private async configure(): Promise<void> {
    const selected = await vscode.window.showQuickPick(
      cloudProviderDefinitions.map((provider) => ({
        label: provider.label,
        description: provider.id,
        detail: provider.productionNote,
        provider,
      })),
      { placeHolder: "Choose a cloud model provider" },
    );
    if (!selected) return;
    await this.options.accounts.ensure(selected.provider.id);
    const existingAccounts = this.options.accounts.forProvider(
      selected.provider.id,
    );
    const accountChoice = await vscode.window.showQuickPick(
      [
        {
          label: "$(add) Create a new account",
          description: "Store another key",
          account: undefined,
        },
        ...existingAccounts.map((account) => ({
          label: account.label,
          description: account.status,
          account,
        })),
      ],
      { placeHolder: `Choose a ${selected.label} account` },
    );
    if (!accountChoice) return;
    let account: ProviderAccount | undefined = accountChoice.account;
    if (!account) {
      const label = await vscode.window.showInputBox({
        prompt: `${selected.label} account label`,
        value: `${selected.label} account`,
        validateInput: (value) =>
          value.trim() ? undefined : "An account label is required.",
      });
      if (!label?.trim()) return;
      const timestamp = new Date().toISOString();
      account = {
        id: randomUUID(),
        providerId: selected.provider.id,
        label: label.trim(),
        authMethod: "api-key",
        status: "active",
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    }
    const configuration = this.options.configuration();
    const model = await vscode.window.showInputBox({
      prompt: `Model ID for ${selected.label}`,
      value:
        configuration.provider === selected.provider.id
          ? configuration.model
          : "",
      validateInput: (value) =>
        value.trim() ? undefined : "A model ID is required.",
    });
    if (!model?.trim()) return;
    const apiKey = await vscode.window.showInputBox({
      prompt: `${selected.label} API key`,
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) =>
        value.trim() ? undefined : "An API key is required.",
    });
    if (!apiKey?.trim()) return;
    account = {
      ...account,
      status: "active",
      updatedAt: new Date().toISOString(),
    };
    await this.options.accounts.add(account, apiKey);
    await this.options.applyConfiguration({
      ...configuration,
      provider: selected.provider.id,
      baseUrl: selected.provider.baseUrl,
      model: model.trim(),
      credentialAccountId: account.id,
    });
    void vscode.window.showInformationMessage(
      `${brand.productName} is configured for ${selected.label} / ${account.label}. Its API key is stored in VS Code Secret Storage.`,
    );
  }

  private async removeCredential(): Promise<void> {
    const selectedProvider = await vscode.window.showQuickPick(
      cloudProviderDefinitions.map((provider) => ({
        label: provider.label,
        description: provider.id,
        provider,
      })),
      { placeHolder: "Choose a provider" },
    );
    if (!selectedProvider) return;
    const account = await this.options.accounts.ensure(
      selectedProvider.provider.id,
    );
    if (!account) return;
    const selectedAccount = await vscode.window.showQuickPick(
      this.options.accounts
        .forProvider(selectedProvider.provider.id)
        .map((candidate) => ({
          label: candidate.label,
          description: candidate.status,
          account: candidate,
        })),
      { placeHolder: `Remove a ${selectedProvider.label} account key` },
    );
    if (!selectedAccount) return;
    await this.options.accounts.deleteCredential(selectedAccount.account.id);
    const configuration = this.options.configuration();
    if (
      configuration.provider === selectedProvider.provider.id &&
      configuration.credentialAccountId === selectedAccount.account.id
    ) {
      await this.options.resetRuntime();
    }
    void vscode.window.showInformationMessage(
      `${brand.productName} removed the stored ${selectedProvider.label} account key.`,
    );
  }
}
