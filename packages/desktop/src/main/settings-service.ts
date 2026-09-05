import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  McpServerManager,
  type McpServerStatus,
  type McpStdioServerConfiguration,
  parseMcpServerConfigurations,
} from "@truss-harness/mcp";
import {
  cloudProviderDefinition,
  detectActiveLocalModel,
  detectLocalContextWindow,
  detectLocalEndpoints,
  isCloudProviderId,
  isLocalEndpointKind,
  listLocalModels,
} from "@truss-harness/provider-openai-compatible";
import {
  ApiKeyCredential,
  defaultProviderAccountId,
  type ProviderAccount,
  ToolRegistry,
  type UpdateProviderAccountInput,
} from "@truss-harness/runtime";
import type {
  DesktopConfiguration,
  DesktopConversation,
  DesktopCredentialStorage,
  DesktopEndpoint,
  DesktopModelInfo,
  DesktopProvider,
  DesktopState,
  DesktopThemePreference,
  DesktopWorkspaceUiState,
} from "../shared.js";
import { recoverStartupRuntime } from "../startup-runtime.js";
import { discoverCloudModels } from "./cloud-model-discovery.js";
import type { CredentialService } from "./credential-service.js";
import {
  isLocalConfiguration,
  isThemePreference,
  localEndpoint,
  normalizeConfiguration,
  normalizeWorkspaceUiState,
} from "./desktop-configuration.js";
import type { ManagedAgentService } from "./managed-agent-service.js";
import {
  type DesktopRuntimeService,
  safeRuntimeConfigurationError,
} from "./runtime-service.js";
import type { DesktopUpdateService } from "./update-service.js";

export class DesktopSettingsService {
  constructor(
    private readonly state: () => DesktopState,
    private readonly setState: (state: DesktopState) => void,
    private readonly persist: () => Promise<void>,
    private readonly credentials: CredentialService,
    private readonly runtime: DesktopRuntimeService,
    private readonly agents: ManagedAgentService,
    private readonly updates: DesktopUpdateService,
    private readonly chooseWorkspacePath: () => Promise<string | undefined>,
    private readonly setZoom: (zoomFactor: number) => void,
  ) {}

  async configureStartupRuntime(): Promise<void> {
    const configuration = this.state().configuration;
    if (!configuration) return;
    let runtimeConfiguration = configuration;
    if (isCloudProviderId(runtimeConfiguration.provider)) {
      const accountId = this.ensureProviderAccount(
        runtimeConfiguration.provider,
        runtimeConfiguration.credentialAccountId,
      );
      if (runtimeConfiguration.credentialAccountId !== accountId) {
        runtimeConfiguration = {
          ...runtimeConfiguration,
          credentialAccountId: accountId,
        };
        this.setState({
          ...this.state(),
          configuration: runtimeConfiguration,
        });
        await this.persist();
      }
      await this.credentials.migrateLegacy(
        runtimeConfiguration.provider,
        accountId,
      );
    }
    const result = await recoverStartupRuntime(
      () => this.runtime.configure(runtimeConfiguration),
      () => this.runtime.dispose(),
    );
    if (result.status === "recovered")
      this.setState({
        ...this.state(),
        mcpStatuses: [],
        runtimeError: safeRuntimeConfigurationError(
          runtimeConfiguration,
          result.error,
        ),
      });
  }

  async testMcpServer(
    name: string,
    input: McpStdioServerConfiguration,
  ): Promise<McpServerStatus> {
    const normalizedName = name.trim();
    if (!normalizedName) throw new Error("An MCP server name is required.");
    const configurations = parseMcpServerConfigurations({
      [normalizedName]: { ...input, enabled: true },
    });
    const manager = new McpServerManager(new ToolRegistry(), configurations, {
      workspaceRoot: this.state().workspaceRoot,
    });
    try {
      return (
        (await manager.connect(normalizedName)) ?? {
          name: normalizedName,
          state: "failed",
          toolCount: 0,
          error: "The MCP server could not be tested.",
        }
      );
    } finally {
      await manager.close();
    }
  }

  credentialStorage(): DesktopCredentialStorage {
    return this.credentials.storageKind();
  }

  async configureTheme(theme: DesktopThemePreference): Promise<DesktopState> {
    if (!isThemePreference(theme))
      throw new Error(
        "Choose a valid desktop theme and use #RRGGBB colors for custom palette values.",
      );
    this.setState({
      ...this.state(),
      theme:
        theme.name === "custom"
          ? { name: "custom", custom: theme.custom ?? {} }
          : { name: theme.name },
    });
    await this.persist();
    return this.state();
  }

  async adjustZoom(direction: unknown): Promise<number> {
    if (direction !== -1 && direction !== 1)
      throw new Error("Zoom direction must be -1 or 1.");
    const zoomFactor =
      Math.round(
        Math.min(2, Math.max(0.7, this.state().zoomFactor + direction * 0.1)) *
          100,
      ) / 100;
    this.setState({ ...this.state(), zoomFactor });
    this.setZoom(zoomFactor);
    await this.persist();
    return zoomFactor;
  }

  async configureUpdates(
    input: DesktopState["updates"],
  ): Promise<DesktopState> {
    this.setState({
      ...this.state(),
      updates: {
        checkOnLaunch: input.checkOnLaunch !== false,
        autoDownload: input.autoDownload === true,
      },
    });
    this.updates.setAutoDownload(this.state().updates.autoDownload);
    await this.persist();
    return this.state();
  }

  checkForUpdates(): Promise<void> {
    return this.updates.check();
  }

  downloadUpdate(): Promise<void> {
    return this.updates.download();
  }

  installUpdate(): void {
    this.updates.install();
  }

  async chooseWorkspace(): Promise<DesktopState | undefined> {
    const workspaceRoot = await this.chooseWorkspacePath();
    if (!workspaceRoot) return undefined;
    const workspaceChanged =
      resolve(workspaceRoot) !== resolve(this.state().workspaceRoot);
    this.setState({
      ...this.state(),
      workspaceRoot,
      workspaceUiState: workspaceChanged
        ? undefined
        : this.state().workspaceUiState,
    });
    if (workspaceChanged) await this.agents.configure();
    const configuration = this.state().configuration;
    if (configuration) await this.runtime.configure(configuration);
    await this.persist();
    return this.state();
  }

  async saveConversations(
    conversations: readonly DesktopConversation[],
    activeConversationId?: string,
  ): Promise<void> {
    this.setState({
      ...this.state(),
      conversations: conversations.slice(0, 30),
      activeConversationId,
    });
    await this.persist();
  }

  async discoverModels(
    partial?: Partial<DesktopConfiguration>,
    apiKey?: string,
  ): Promise<{
    readonly endpoints: readonly DesktopEndpoint[];
    readonly models: readonly DesktopModelInfo[];
  }> {
    const requestedProvider = partial?.provider;
    if (requestedProvider && isCloudProviderId(requestedProvider)) {
      const definition = cloudProviderDefinition(requestedProvider);
      const credential =
        apiKey?.trim() ||
        (partial.credentialAccountId
          ? await this.credentials.get(partial.credentialAccountId)
          : await this.credentials.get(requestedProvider));
      if (!credential)
        throw new Error(`Enter an API key for ${definition.label} first.`);
      const models = await discoverCloudModels(
        definition,
        partial.baseUrl || definition.baseUrl,
        credential,
      );
      return { endpoints: [], models };
    }
    const current = this.state().configuration;
    const configuration =
      partial?.baseUrl && isLocalEndpointKind(partial.provider)
        ? { provider: partial.provider, baseUrl: partial.baseUrl }
        : current && isLocalConfiguration(current)
          ? { provider: current.provider, baseUrl: current.baseUrl }
          : undefined;
    const endpoints = await detectLocalEndpoints();
    const endpoint = configuration
      ? localEndpoint(configuration)
      : endpoints[0];
    let models: readonly DesktopModelInfo[] = [];
    if (endpoint) {
      try {
        models = (await listLocalModels(endpoint)).map((model) => ({
          id: model.name,
          kind: "chat" as const,
        }));
      } catch {
        // Manual model entry remains available when discovery fails.
      }
    }
    return { endpoints, models };
  }

  async refreshLocalModel(): Promise<DesktopState> {
    const endpoints = await detectLocalEndpoints();
    const current = this.state().configuration;
    const matchingEndpoint =
      current &&
      endpoints.find(
        (endpoint) =>
          endpoint.kind === current.provider &&
          endpoint.baseUrl === current.baseUrl,
      );
    const selected = matchingEndpoint
      ? {
          endpoint: matchingEndpoint,
          model: (await listLocalModels(matchingEndpoint))[0],
        }
      : await detectActiveLocalModel({ endpoints });
    if (!selected?.model)
      throw new Error(
        "No loaded local model was detected. Start a local server and load a model, then refresh.",
      );
    let next = normalizeConfiguration({
      ...(current ?? {
        mode: "chat" as const,
        permission: "ask" as const,
        contextWindow: 8_192,
        internetAccess: false,
        mcpServers: {},
      }),
      provider: selected.endpoint.kind,
      baseUrl: selected.endpoint.baseUrl,
      model: selected.model.name,
    });
    const contextWindow = await detectLocalContextWindow(
      selected.endpoint,
      selected.model.name,
    ).catch(() => undefined);
    if (contextWindow) next = { ...next, contextWindow };
    this.setState({ ...this.state(), configuration: next });
    await this.agents.configure();
    await this.runtime.configure(next);
    if (configurationChanged(current, next)) void releaseOllamaModel(current);
    await this.persist();
    return this.state();
  }

  async configure(
    input: DesktopConfiguration,
    apiKey?: string,
  ): Promise<DesktopState> {
    let next = normalizeConfiguration(input);
    if (!next.baseUrl || !next.model)
      throw new Error("An endpoint and model are required.");
    if (isCloudProviderId(next.provider)) {
      const provider = next.provider;
      const accountId = this.ensureProviderAccount(
        provider,
        next.credentialAccountId,
      );
      next = { ...next, credentialAccountId: accountId };
      await this.credentials.migrateLegacy(provider, accountId);
      if (apiKey?.trim())
        await this.credentials.save(provider, accountId, apiKey.trim());
      if (!(await this.credentials.get(accountId)))
        throw new Error(
          `Enter an API key for ${cloudProviderDefinition(provider).label}.`,
        );
    }
    const detectedContextWindow = isLocalConfiguration(next)
      ? await detectLocalContextWindow(localEndpoint(next), next.model).catch(
          () => undefined,
        )
      : undefined;
    if (detectedContextWindow)
      next = { ...next, contextWindow: detectedContextWindow };
    const previous = this.state().configuration;
    this.setState({ ...this.state(), configuration: next });
    await this.agents.configure();
    await this.runtime.configure(next);
    if (configurationChanged(previous, next)) void releaseOllamaModel(previous);
    await this.persist();
    return this.state();
  }

  async testProviderConnection(input: DesktopConfiguration, apiKey?: string) {
    const configuration = normalizeConfiguration(input);
    if (!configuration.baseUrl || !configuration.model)
      throw new Error("Choose a provider endpoint and model before testing.");
    const credential =
      apiKey?.trim() && isCloudProviderId(configuration.provider)
        ? new ApiKeyCredential(
            `desktop:test:${configuration.provider}`,
            apiKey.trim(),
          )
        : undefined;
    return this.agents.testProviderConnection(configuration, credential);
  }

  async saveWorkspaceUiState(state: DesktopWorkspaceUiState): Promise<void> {
    this.setState({
      ...this.state(),
      workspaceUiState: normalizeWorkspaceUiState(state),
    });
    await this.persist();
  }

  async clearCredential(
    provider: DesktopProvider,
    accountId?: string,
  ): Promise<void> {
    if (!isCloudProviderId(provider)) return;
    await this.credentials.remove(provider, accountId);
    if (
      this.state().configuration?.provider === provider &&
      (!accountId ||
        this.state().configuration?.credentialAccountId === accountId)
    )
      await this.runtime.dispose();
  }

  async saveProviderAccount(
    input: {
      readonly id?: string;
      readonly providerId: DesktopProvider;
      readonly label: string;
      readonly authMethod: "api-key";
    },
    apiKey: string,
  ): Promise<DesktopState> {
    if (!isCloudProviderId(input.providerId))
      throw new Error("Only cloud providers can store API-key accounts.");
    if (input.authMethod !== "api-key")
      throw new Error("This account currently supports API keys only.");
    if (!input.label.trim())
      throw new Error("A provider account requires a label.");
    if (!apiKey.trim()) throw new Error("Enter an API key for this account.");
    const existing = input.id ? this.account(input.id) : undefined;
    if (input.id && (!existing || existing.providerId !== input.providerId))
      throw new Error("The selected provider account no longer exists.");
    const timestamp = new Date().toISOString();
    const account: ProviderAccount = existing
      ? { ...existing, label: input.label.trim(), updatedAt: timestamp }
      : {
          id: randomUUID(),
          providerId: input.providerId,
          label: input.label.trim(),
          authMethod: "api-key",
          status: "active",
          createdAt: timestamp,
          updatedAt: timestamp,
        };
    this.setState({
      ...this.state(),
      providerAccounts: [
        ...(this.state().providerAccounts ?? []).filter(
          (candidate) => candidate.id !== account.id,
        ),
        account,
      ],
    });
    await this.credentials.save(input.providerId, account.id, apiKey.trim());
    await this.persist();
    return this.state();
  }

  async updateProviderAccount(
    id: string,
    input: UpdateProviderAccountInput,
  ): Promise<DesktopState> {
    const existing = this.account(id);
    if (!existing) throw new Error("Unknown provider account.");
    if (input.label !== undefined && !input.label.trim())
      throw new Error("A provider account requires a label.");
    if (
      input.status !== undefined &&
      !["active", "reauth-required", "disabled"].includes(input.status)
    )
      throw new Error("A provider account has an unsupported status.");
    const account: ProviderAccount = {
      ...existing,
      ...(input.label !== undefined ? { label: input.label.trim() } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.scopes !== undefined
        ? { scopes: [...new Set(input.scopes)] }
        : {}),
      updatedAt: new Date().toISOString(),
    };
    this.setState({
      ...this.state(),
      providerAccounts: (this.state().providerAccounts ?? []).map(
        (candidate) => (candidate.id === id ? account : candidate),
      ),
    });
    await this.persist();
    return this.state();
  }

  async deleteProviderAccount(id: string): Promise<DesktopState> {
    const existing = this.account(id);
    if (!existing) throw new Error("Unknown provider account.");
    if (isCloudProviderId(existing.providerId))
      await this.credentials.remove(existing.providerId, id);
    const active = this.state().configuration?.credentialAccountId === id;
    const configuration = this.state().configuration;
    this.setState({
      ...this.state(),
      providerAccounts: (this.state().providerAccounts ?? []).filter(
        (account) => account.id !== id,
      ),
      ...(active && configuration
        ? {
            configuration: {
              ...configuration,
              credentialAccountId: undefined,
            },
          }
        : {}),
    });
    if (active) await this.runtime.dispose();
    await this.persist();
    return this.state();
  }

  private account(reference: string): ProviderAccount | undefined {
    return this.state().providerAccounts?.find(
      (account) => account.id === reference,
    );
  }

  private ensureProviderAccount(
    provider: Extract<DesktopProvider, string>,
    requestedId?: string,
  ): string {
    if (!isCloudProviderId(provider))
      throw new Error("Only cloud providers have credential accounts.");
    const existing = requestedId?.trim()
      ? this.account(requestedId.trim())
      : undefined;
    if (existing?.providerId === provider) return existing.id;
    const id = defaultProviderAccountId(provider);
    if (this.account(id)) return id;
    const timestamp = new Date().toISOString();
    const account: ProviderAccount = {
      id,
      providerId: provider,
      label: cloudProviderDefinition(provider).label,
      authMethod: "api-key",
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.setState({
      ...this.state(),
      providerAccounts: [...(this.state().providerAccounts ?? []), account],
    });
    return id;
  }
}

function configurationChanged(
  previous: DesktopConfiguration | undefined,
  next: DesktopConfiguration,
): boolean {
  return (
    previous?.model !== next.model ||
    previous?.baseUrl !== next.baseUrl ||
    previous?.provider !== next.provider
  );
}

async function releaseOllamaModel(
  configuration: DesktopConfiguration | undefined,
): Promise<void> {
  if (configuration?.provider !== "ollama" || !configuration.model) return;
  try {
    await fetch(`${configuration.baseUrl.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: configuration.model, keep_alive: 0 }),
      signal: AbortSignal.timeout(2_000),
    });
  } catch {
    // Local server lifecycle is provider-owned; release is best-effort.
  }
}
