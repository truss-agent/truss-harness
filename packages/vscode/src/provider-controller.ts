import { AgentHost } from "@truss-harness/agent-host";
import {
  cloudProviderDefinition,
  cloudProviderDefinitions,
  detectActiveLocalModel,
  detectLocalEndpoints,
  isCloudProviderId,
  listLocalModels,
  type ModelProviderKind,
} from "@truss-harness/provider-openai-compatible";
import { ApiKeyCredential, type ProviderAccount } from "@truss-harness/runtime";
import type * as vscode from "vscode";
import type {
  DiscoveredModel,
  HostState,
  ModelConfiguration,
} from "./contracts.js";
import {
  discoveredModel,
  isLocalConfiguration,
  localEndpoint,
  normalizeConfiguration,
} from "./model-configuration.js";
import type { ProviderAccountStore } from "./provider-accounts.js";

export interface ProviderControllerOptions {
  readonly context: vscode.ExtensionContext;
  readonly accounts: ProviderAccountStore;
  readonly workspaceRoot: () => string;
  readonly configuration: () => ModelConfiguration;
  readonly setConfiguration: (
    configuration: ModelConfiguration,
  ) => Promise<void>;
}

export class ProviderController {
  constructor(private readonly options: ProviderControllerOptions) {}

  apiKeyForReference(
    provider: ModelProviderKind,
    reference?: string,
  ): Promise<string | undefined> {
    return this.options.accounts.apiKey(provider, reference);
  }

  apiKey(
    provider = this.options.configuration().provider,
  ): Promise<string | undefined> {
    const configuration = this.options.configuration();
    return this.apiKeyForReference(provider, configuration.credentialAccountId);
  }

  async runtimeEnvironment(): Promise<NodeJS.ProcessEnv> {
    const configuration = this.options.configuration();
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      TRUSS_HARNESS_PROVIDER: configuration.provider,
      TRUSS_HARNESS_BASE_URL: configuration.baseUrl,
      TRUSS_HARNESS_MODEL: configuration.model,
      TRUSS_HARNESS_AGENT_MODE: configuration.mode,
      TRUSS_HARNESS_PERMISSION_MODE: configuration.permission,
      TRUSS_HARNESS_INTERNET_ACCESS: configuration.internetAccess
        ? "true"
        : "false",
      ...(configuration.masterPrompt?.enabled
        ? { TRUSS_HARNESS_MASTER_PROMPT: configuration.masterPrompt.template }
        : {}),
      TRUSS_HARNESS_MCP_SERVERS: JSON.stringify(configuration.mcpServers),
    };
    if (isCloudProviderId(configuration.provider)) {
      const apiKey = await this.apiKey();
      if (!apiKey) {
        throw new Error(
          `No API key is stored for ${cloudProviderDefinition(configuration.provider).label}. Run 'Truss: Configure BYOK Provider'.`,
        );
      }
      environment.TRUSS_HARNESS_API_KEY = apiKey;
    }
    return environment;
  }

  async testConnection(
    candidate = this.options.configuration(),
    apiKeyOverride?: string,
  ) {
    if (!candidate.model.trim()) {
      throw new Error("Choose a provider model before testing the connection.");
    }
    const apiKey =
      apiKeyOverride?.trim() ||
      (isCloudProviderId(candidate.provider)
        ? await this.apiKeyForReference(
            candidate.provider,
            candidate.credentialAccountId,
          )
        : undefined);
    const host = new AgentHost({
      workspaceRoot: this.options.workspaceRoot(),
      credentialResolver: {
        async resolve() {
          return apiKey
            ? new ApiKeyCredential("vscode-connection-test", apiKey)
            : undefined;
        },
      },
    });
    return host.testProviderConnection({
      providerId: candidate.provider,
      endpointUrl: candidate.baseUrl,
      modelId: candidate.model,
      ...(apiKey ? { credentialRef: "configuration" } : {}),
    });
  }

  async saveAccount(
    provider: ModelProviderKind,
    apiKey: string,
    accountId?: string,
    accountLabel?: string,
    selectedConfiguration?: ModelConfiguration,
  ): Promise<ProviderAccount> {
    if (!isCloudProviderId(provider)) {
      throw new Error("Only cloud providers require an API key.");
    }
    const account = await this.options.accounts.save(
      provider,
      apiKey,
      accountId,
      accountLabel,
    );
    const current = this.options.configuration();
    if (
      selectedConfiguration?.provider === provider ||
      current.provider === provider
    ) {
      await this.options.setConfiguration({
        ...(selectedConfiguration
          ? normalizeConfiguration(selectedConfiguration)
          : current),
        provider,
        baseUrl: cloudProviderDefinition(provider).baseUrl,
        credentialAccountId: account.id,
      });
    }
    return account;
  }

  async removeAccount(accountId: string): Promise<void> {
    const account = await this.options.accounts.remove(accountId);
    const current = this.options.configuration();
    if (current.credentialAccountId === account.id) {
      await this.options.setConfiguration({
        ...current,
        credentialAccountId: undefined,
      });
    }
  }

  async state(
    selectedConfiguration = this.options.configuration(),
    discoveryApiKey?: string,
  ): Promise<HostState> {
    if (!selectedConfiguration.model) {
      const current = selectedConfiguration === this.options.configuration();
      const detected = isLocalConfiguration(selectedConfiguration)
        ? await detectActiveLocalModel()
        : undefined;
      if (detected) {
        selectedConfiguration = {
          ...selectedConfiguration,
          provider: detected.endpoint.kind,
          baseUrl: detected.endpoint.baseUrl,
          model: detected.model.name,
        };
        if (current) await this.options.setConfiguration(selectedConfiguration);
      }
    }
    let models: readonly DiscoveredModel[] = [];
    if (isLocalConfiguration(selectedConfiguration)) {
      try {
        models = (
          await listLocalModels(localEndpoint(selectedConfiguration))
        ).map((model) => ({ id: model.name }));
      } catch {
        // Manual names remain valid for custom endpoints.
      }
    } else {
      try {
        models = await this.discoverCloudModels(
          selectedConfiguration,
          discoveryApiKey,
        );
      } catch {
        // A manual cloud model ID remains valid when discovery is blocked.
      }
    }
    return {
      configuration: selectedConfiguration,
      endpoints: await detectLocalEndpoints(),
      models,
      providerAccounts: await this.options.accounts.states(),
      cloudProviders: cloudProviderDefinitions.map(
        ({ id, label, baseUrl }) => ({
          id,
          label,
          baseUrl,
        }),
      ),
    };
  }

  private async discoverCloudModels(
    candidate: ModelConfiguration,
    apiKeyOverride?: string,
  ): Promise<readonly DiscoveredModel[]> {
    if (!isCloudProviderId(candidate.provider)) return [];
    const credential =
      apiKeyOverride?.trim() ||
      (await this.options.accounts.storedApiKey(
        candidate.provider,
        candidate.credentialAccountId,
      ));
    if (!credential) return [];
    const definition = cloudProviderDefinition(candidate.provider);
    const baseUrl = definition.baseUrl.replace(/\/$/, "");
    const response = await fetch(
      definition.compatibility === "ollama-api"
        ? `${baseUrl}/api/tags`
        : `${baseUrl}/models`,
      { headers: { Authorization: `Bearer ${credential}` } },
    );
    if (!response.ok) return [];
    const payload = (await response.json()) as {
      readonly data?: readonly unknown[];
      readonly models?: readonly unknown[];
    };
    const records =
      definition.compatibility === "ollama-api"
        ? (payload.models ?? [])
        : (payload.data ?? []);
    return [
      ...new Map(
        records.flatMap((record) => {
          const model = discoveredModel(record, candidate.provider);
          return model ? [[model.id, model] as const] : [];
        }),
      ).values(),
    ];
  }
}
