import {
  AgentHost,
  createHostedRuntime,
  parseMcpServerConfigurations,
  type AgentMode,
  type HostedRuntime,
  type HostedRuntimeOptions,
  type ProviderConnectionResult,
} from "@truss-harness/agent-host";
import { ApiKeyCredential } from "@truss-harness/runtime";
import {
  cloudProviderDefinition,
  isCloudProviderId,
  isLocalEndpointKind,
  type ModelProviderKind,
} from "@truss-harness/provider-openai-compatible";

export type { AgentMode };
export interface ClientRuntimeOptions extends HostedRuntimeOptions {}
export interface ClientRuntime extends HostedRuntime {}
export async function createClientRuntime(
  options: ClientRuntimeOptions,
): Promise<ClientRuntime> {
  return createHostedRuntime(options);
}
export interface ClientConfiguration extends ClientRuntimeOptions {}

/** Tests the configured provider without starting a chat session or MCP server. */
export async function testClientProviderConnection(
  options: ClientRuntimeOptions,
): Promise<ProviderConnectionResult> {
  const credential =
    options.credential ??
    (options.apiKey
      ? new ApiKeyCredential(`${options.provider}-api-key`, options.apiKey)
      : undefined);
  const host = new AgentHost({
    workspaceRoot: options.workspaceRoot,
    providerRegistry: options.providerRegistry,
    credentialResolver: { resolve: async () => credential },
  });
  return host.testProviderConnection({
    providerId: options.provider,
    endpointUrl: options.baseUrl,
    modelId: options.model,
    ...(credential
      ? { credentialRef: options.credentialRef ?? "direct" }
      : {}),
  });
}

export function configurationFromEnvironment(
  workspaceRoot: string,
  environment: NodeJS.ProcessEnv = process.env,
): ClientConfiguration {
  const configuredProvider = environment.TRUSS_HARNESS_PROVIDER;
  const provider: ModelProviderKind =
    isLocalEndpointKind(configuredProvider) ||
    isCloudProviderId(configuredProvider)
      ? configuredProvider
      : "ollama";
  const mode =
    environment.TRUSS_HARNESS_AGENT_MODE === "edit" ||
    environment.TRUSS_HARNESS_AGENT_MODE === "plan"
      ? environment.TRUSS_HARNESS_AGENT_MODE
      : "chat";
  const baseUrl =
    environment.TRUSS_HARNESS_BASE_URL ??
    (provider === "ollama"
      ? "http://localhost:11434"
      : provider === "openai-compatible"
        ? "http://localhost:1234/v1"
        : cloudProviderDefinition(provider).baseUrl);
  const model = environment.TRUSS_HARNESS_MODEL;
  if (!model) {
    throw new Error(
      "Set TRUSS_HARNESS_MODEL to the model name exposed by your OpenAI-compatible server.",
    );
  }
  const credentialRef = environment.TRUSS_HARNESS_PROVIDER_ACCOUNT?.trim();
  const accountApiKey = credentialRef
    ? environment[
        `TRUSS_HARNESS_API_KEY_ACCOUNT_${credentialRef
          .replace(/[^a-zA-Z0-9]+/g, "_")
          .toUpperCase()}`
      ]
    : undefined;

  return {
    workspaceRoot,
    provider,
    baseUrl,
    model,
    credentialRef: credentialRef || undefined,
    apiKey:
      environment.TRUSS_HARNESS_API_KEY ??
      accountApiKey ??
      (isCloudProviderId(provider)
        ? environment[
            cloudProviderDefinition(provider).apiKeyEnvironmentVariable
          ]
        : undefined),
    systemPrompt: environment.TRUSS_HARNESS_SYSTEM_PROMPT,
    mode,
    internetAccess:
      environment.TRUSS_HARNESS_INTERNET_ACCESS === "true" ||
      environment.TRUSS_HARNESS_INTERNET_ACCESS === "1",
    mcpServers: environment.TRUSS_HARNESS_MCP_SERVERS
      ? parseMcpServerConfigurations(
          JSON.parse(environment.TRUSS_HARNESS_MCP_SERVERS) as unknown,
        )
      : undefined,
  };
}
