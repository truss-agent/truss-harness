import type { McpServerConfigurations } from "@truss-harness/mcp";
import type { ModelProviderKind } from "@truss-harness/provider-openai-compatible";
import {
  type AgentProfile,
  ApiKeyCredential,
  type CredentialProvider,
  type ToolApproval,
} from "@truss-harness/runtime";
import { AgentHost, type AgentMode, type HostedRuntime } from "./host.js";
import type { AgentProviderRegistry } from "./providers.js";

/** Compatibility options for existing single-agent clients. */
export interface HostedRuntimeOptions {
  readonly workspaceRoot: string;
  readonly provider: ModelProviderKind;
  readonly baseUrl: string;
  readonly model: string;
  /** Opaque provider-account reference used by clients that manage multiple credentials. */
  readonly credentialRef?: string;
  readonly apiKey?: string;
  readonly credential?: CredentialProvider;
  readonly systemPrompt?: string;
  readonly approval?: ToolApproval;
  readonly mode?: AgentMode;
  readonly internetAccess?: boolean;
  readonly mcpServers?: McpServerConfigurations;
  readonly providerRegistry?: AgentProviderRegistry;
}

/**
 * Compatibility constructor used by existing CLI, Desktop, and TUI flows.
 * New multi-agent clients should create an AgentHost and use its factory.
 */
export async function createHostedRuntime(
  options: HostedRuntimeOptions,
): Promise<HostedRuntime> {
  const mode = options.mode ?? "chat";
  const credential =
    options.credential ??
    (options.apiKey
      ? new ApiKeyCredential(`${options.provider}-api-key`, options.apiKey)
      : undefined);
  const profile: AgentProfile = {
    id: "single-agent",
    displayName: "Default agent",
    provider: {
      providerId: options.provider,
      endpointUrl: options.baseUrl,
      modelId: options.model,
      ...(credential
        ? { credentialRef: options.credentialRef ?? "direct" }
        : {}),
    },
    mode,
    approvalPolicy: "ask",
    internetAccess: options.internetAccess ?? false,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
  const host = new AgentHost({
    workspaceRoot: options.workspaceRoot,
    systemPrompt: options.systemPrompt,
    mcpServers: options.mcpServers,
    approvalFactory: () => options.approval,
    providerRegistry: options.providerRegistry,
    credentialResolver: { resolve: async () => credential },
  });
  return host.createRuntime(profile);
}
