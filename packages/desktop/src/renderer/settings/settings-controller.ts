import type {
  McpServerStatus,
  McpStdioServerConfiguration,
} from "@truss-harness/mcp";
import type { ProviderAccount } from "@truss-harness/runtime";
import type {
  DesktopConfiguration,
  DesktopModelInfo,
  DesktopProvider,
} from "../../shared.js";

export type ModelSettingsTab = "local" | "byok";

export function isLocalProvider(
  provider: DesktopProvider,
): provider is "ollama" | "openai-compatible" {
  return provider === "ollama" || provider === "openai-compatible";
}

export function parseMcpConfigurations(
  source: string,
): Record<string, McpStdioServerConfiguration> {
  if (!source.trim()) return {};
  const parsed = JSON.parse(source) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("MCP servers must be a JSON object.");
  return parsed as Record<string, McpStdioServerConfiguration>;
}

export function preferredProviderAccount(
  accounts: readonly ProviderAccount[],
  provider: DesktopProvider,
  preferredId?: string,
  currentId?: string,
): ProviderAccount | undefined {
  const matching = accounts.filter(
    (account) => account.providerId === provider,
  );
  return (
    matching.find((account) => account.id === preferredId) ??
    matching.find((account) => account.id === currentId) ??
    matching[0]
  );
}

export interface SettingsConfigurationInput {
  readonly current: DesktopConfiguration;
  readonly modelTab: ModelSettingsTab;
  readonly localProvider: DesktopProvider;
  readonly localBaseUrl: string;
  readonly localModel: string;
  readonly cloudProvider: DesktopProvider;
  readonly cloudBaseUrl: string;
  readonly cloudModel: string;
  readonly credentialAccountId?: string;
  readonly permission: string;
  readonly contextWindow: string;
  readonly selectedModel?: DesktopModelInfo;
  readonly internetAccess: boolean;
  readonly masterPromptEnabled?: boolean;
  readonly masterPromptTemplate?: string;
  readonly autocompleteEnabled: boolean;
  readonly autocompleteModel: string;
  readonly formatOnSave: boolean;
  readonly mcpServers: Record<string, McpStdioServerConfiguration>;
}

export function buildSettingsConfiguration(
  input: SettingsConfigurationInput,
): DesktopConfiguration {
  const provider =
    input.modelTab === "byok" ? input.cloudProvider : input.localProvider;
  const reusingCurrentProvider = provider === input.current.provider;
  const local = isLocalProvider(provider);
  const baseUrl =
    (local ? input.localBaseUrl : input.cloudBaseUrl).trim() ||
    (reusingCurrentProvider ? input.current.baseUrl : "");
  const model =
    (input.modelTab === "byok" ? input.cloudModel : input.localModel).trim() ||
    (reusingCurrentProvider ? input.current.model : "");
  if (!baseUrl || !model)
    throw new Error(
      "Choose a provider endpoint and model before applying agent settings.",
    );
  const modelContextWindow = input.selectedModel?.contextWindow;
  return {
    provider,
    baseUrl,
    model,
    credentialAccountId:
      input.modelTab === "byok" ? input.credentialAccountId : undefined,
    mode: input.current.mode,
    permission:
      input.permission === "auto-read" || input.permission === "auto-all"
        ? input.permission
        : "ask",
    contextWindow: local
      ? Math.max(512, Number.parseInt(input.contextWindow, 10) || 8_192)
      : (modelContextWindow ?? 8_192),
    ...(local || modelContextWindow === undefined
      ? {}
      : { modelContextWindow }),
    internetAccess: input.internetAccess,
    masterPrompt:
      input.masterPromptTemplate === undefined
        ? input.current.masterPrompt
        : {
            enabled: input.masterPromptEnabled === true,
            template: input.masterPromptTemplate,
          },
    autocomplete: {
      enabled: input.autocompleteEnabled,
      model: input.autocompleteModel.trim() || undefined,
    },
    formatOnSave: input.formatOnSave,
    mcpServers: input.mcpServers,
  };
}

export function buildProviderConnectionConfiguration(
  input: Pick<
    SettingsConfigurationInput,
    | "current"
    | "modelTab"
    | "localProvider"
    | "localBaseUrl"
    | "localModel"
    | "cloudProvider"
    | "cloudBaseUrl"
    | "cloudModel"
    | "credentialAccountId"
  >,
): DesktopConfiguration {
  const provider =
    input.modelTab === "byok" ? input.cloudProvider : input.localProvider;
  const reusingCurrentProvider = provider === input.current.provider;
  const baseUrl =
    (isLocalProvider(provider)
      ? input.localBaseUrl
      : input.cloudBaseUrl
    ).trim() || (reusingCurrentProvider ? input.current.baseUrl : "");
  const model =
    (input.modelTab === "byok" ? input.cloudModel : input.localModel).trim() ||
    (reusingCurrentProvider ? input.current.model : "");
  if (!baseUrl || !model)
    throw new Error("Choose a provider endpoint and model before testing.");
  return {
    ...input.current,
    provider,
    baseUrl,
    model,
    credentialAccountId:
      input.modelTab === "byok" ? input.credentialAccountId : undefined,
  };
}

/** Owns mutable settings draft state independently from the renderer shell. */
export class SettingsController {
  modelTab: ModelSettingsTab = "local";
  selectedProviderAccountId: string | undefined;
  creatingProviderAccount = false;
  mcpDraft: Record<string, McpStdioServerConfiguration> = {};
  editingMcpName: string | undefined;
  readonly testedMcpStatuses = new Map<string, McpServerStatus>();
  announcedUpdateVersion: string | undefined;

  loadMcpDraft(
    configurations: Record<string, McpStdioServerConfiguration>,
  ): void {
    this.mcpDraft = { ...configurations };
    this.editingMcpName = undefined;
    this.testedMcpStatuses.clear();
  }

  selectProviderAccount(id?: string): void {
    this.creatingProviderAccount = false;
    this.selectedProviderAccountId = id;
  }

  createProviderAccount(): void {
    this.creatingProviderAccount = true;
    this.selectedProviderAccountId = undefined;
  }

  saveMcpServer(
    name: string,
    configuration: McpStdioServerConfiguration,
  ): void {
    const previousName = this.editingMcpName;
    if (previousName && previousName !== name) {
      const { [previousName]: _previous, ...remaining } = this.mcpDraft;
      this.mcpDraft = remaining;
    }
    this.mcpDraft = { ...this.mcpDraft, [name]: configuration };
    this.testedMcpStatuses.delete(name);
  }

  toggleMcpServer(name: string): void {
    const configuration = this.mcpDraft[name];
    if (!configuration) return;
    this.mcpDraft = {
      ...this.mcpDraft,
      [name]: {
        ...configuration,
        enabled: configuration.enabled === false,
      },
    };
    this.testedMcpStatuses.delete(name);
  }

  removeMcpServer(name: string): void {
    const { [name]: _removed, ...remaining } = this.mcpDraft;
    this.mcpDraft = remaining;
    this.testedMcpStatuses.delete(name);
    if (this.editingMcpName === name) this.editingMcpName = undefined;
  }

  recordMcpStatus(status: McpServerStatus): void {
    this.testedMcpStatuses.set(status.name, status);
  }
}
