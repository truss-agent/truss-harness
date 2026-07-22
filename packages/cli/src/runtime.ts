import { cloudProviderDefinition, createCloudModelProvider, createLocalModelProvider, isCloudProviderId, isLocalEndpointKind, type ModelProviderKind } from "@truss-harness/provider-openai-compatible";
import { parseMcpServerConfigurations, registerMcpServers, type McpServerConfigurations, type McpServerStatus } from "@truss-harness/mcp";
import {
  AgentRuntime,
  CompositeContextManager,
  EventBus,
  FileWorkspaceMemoryStore,
  InMemorySessionStore,
  ToolRegistry,
  WorkspaceMemoryContextProvider,
  WorkspacePlanContextProvider,
  FileWorkspacePlanStore,
  createUpdatePlanTool,
  grepTool,
  listDirectoryTool,
  readFileTool,
  registerCoreTools,
  registerWebTools,
  searchFilesTool,
  ApiKeyCredential,
  type CredentialProvider,
  type ToolApproval,
  type RuntimeEvent
} from "@truss-harness/runtime";

export type AgentMode = "chat" | "plan" | "edit";

export interface ClientRuntimeOptions {
  readonly workspaceRoot: string;
  readonly provider: ModelProviderKind;
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey?: string;
  readonly credential?: CredentialProvider;
  readonly systemPrompt?: string;
  readonly approval?: ToolApproval;
  readonly mode?: AgentMode;
  readonly internetAccess?: boolean;
  readonly mcpServers?: McpServerConfigurations;
}

export interface ClientRuntime {
  readonly runtime: AgentRuntime;
  readonly events: EventBus<RuntimeEvent>;
  readonly mcpServers: readonly McpServerStatus[];
  dispose(): Promise<void>;
}

export async function createClientRuntime(options: ClientRuntimeOptions): Promise<ClientRuntime> {
  const events = new EventBus<RuntimeEvent>();
  const tools = new ToolRegistry();
  const memory = new FileWorkspaceMemoryStore(options.workspaceRoot);
  const plans = new FileWorkspacePlanStore(options.workspaceRoot);
  const credential = options.credential ?? (options.apiKey ? new ApiKeyCredential(`${options.provider}-api-key`, options.apiKey) : undefined);
  if (!isLocalEndpointKind(options.provider) && !credential) {
    throw new Error(`Provider '${options.provider}' requires a credential.`);
  }
  const provider = isLocalEndpointKind(options.provider)
    ? createLocalModelProvider({ kind: options.provider, baseUrl: options.baseUrl, model: options.model, credential })
    : createCloudModelProvider({ provider: options.provider, model: options.model, credential: credential as CredentialProvider });
  const mode = options.mode ?? "chat";
  if (mode === "edit") {
    registerCoreTools(tools);
    tools.register(createUpdatePlanTool(plans));
  }
  if (mode === "plan") {
    tools.register(readFileTool);
    tools.register(listDirectoryTool);
    tools.register(searchFilesTool);
    tools.register(grepTool);
  }
  if (options.internetAccess) registerWebTools(tools);
  const enabledMcpServers = mode === "edit"
    ? options.mcpServers
    : mode === "plan"
      ? Object.fromEntries(Object.entries(options.mcpServers ?? {}).filter(([, server]) => server.readOnly))
      : {};
  const mcp = await registerMcpServers(tools, enabledMcpServers, { workspaceRoot: options.workspaceRoot });

  return {
    events,
    mcpServers: mcp.statuses,
    dispose: () => mcp.close(),
    runtime: new AgentRuntime({
      provider,
      tools,
      sessions: new InMemorySessionStore(),
      context: new CompositeContextManager([new WorkspacePlanContextProvider(plans), new WorkspaceMemoryContextProvider(memory)]),
      events,
      workspaceRoot: options.workspaceRoot,
      systemPrompt: [
        options.systemPrompt,
        mode === "plan" ? "You are in Plan mode. Inspect the workspace with read-only tools as needed, then finish with a concise Markdown checklist exactly in this form: a heading '# Plan: <title>' followed by 3 to 8 actionable '- [ ] <step>' lines. Do not make changes." : undefined,
        mode === "edit" ? "You are an execution agent, not a planning assistant. Treat the user's message as a request to change the workspace even when it is phrased as a declaration. Before each tool call, emit one concise user-visible execution note inside <progress> and </progress>, for example <progress>Inspecting script.js</progress>. These notes must state only the immediate action, never private reasoning. Use tools for every workspace fact and every file change. Start with one relevant inspection tool call (read_file for a named file; search_files or list_directory otherwise). Then make one focused write_file or replace_in_file call and read the changed file to verify it. Do not answer with a proposal, status, or completion claim before tool calls. Never claim a file changed unless that write tool succeeded. If a tool fails, explain the failure and do not claim completion. Do not use the terminal to write files." : undefined
      ].filter(Boolean).join("\n\n"),
      approval: options.approval,
      memory,
      plans,
      savePlanOnCompletion: mode === "plan",
      requireWriteForEditIntent: mode === "edit",
      deferTextUntilToolDecision: mode === "edit"
    })
  };
}

export interface ClientConfiguration extends ClientRuntimeOptions {}

export function configurationFromEnvironment(workspaceRoot: string, environment: NodeJS.ProcessEnv = process.env): ClientConfiguration {
  const configuredProvider = environment.TRUSS_HARNESS_PROVIDER;
  const provider: ModelProviderKind = isLocalEndpointKind(configuredProvider) || isCloudProviderId(configuredProvider) ? configuredProvider : "ollama";
  const mode = environment.TRUSS_HARNESS_AGENT_MODE === "edit" || environment.TRUSS_HARNESS_AGENT_MODE === "plan"
    ? environment.TRUSS_HARNESS_AGENT_MODE
    : "chat";
  const baseUrl = environment.TRUSS_HARNESS_BASE_URL ?? (provider === "ollama" ? "http://localhost:11434" : provider === "openai-compatible" ? "http://localhost:1234/v1" : cloudProviderDefinition(provider).baseUrl);
  const model = environment.TRUSS_HARNESS_MODEL;
  if (!model) {
    throw new Error("Set TRUSS_HARNESS_MODEL to the model name exposed by your OpenAI-compatible server.");
  }

  return {
    workspaceRoot,
    provider,
    baseUrl,
    model,
    apiKey: environment.TRUSS_HARNESS_API_KEY ?? (isCloudProviderId(provider) ? environment[cloudProviderDefinition(provider).apiKeyEnvironmentVariable] : undefined),
    systemPrompt: environment.TRUSS_HARNESS_SYSTEM_PROMPT,
    mode,
    internetAccess: environment.TRUSS_HARNESS_INTERNET_ACCESS === "true" || environment.TRUSS_HARNESS_INTERNET_ACCESS === "1",
    mcpServers: environment.TRUSS_HARNESS_MCP_SERVERS
      ? parseMcpServerConfigurations(JSON.parse(environment.TRUSS_HARNESS_MCP_SERVERS) as unknown)
      : undefined
  };
}
