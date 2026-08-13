import {
  type McpConnections,
  type McpServerConfigurations,
  type McpServerStatus,
  registerMcpServers,
} from "@truss-harness/mcp";
import {
  type AgentApprovalController,
  type AgentProfile,
  type AgentProviderBinding,
  AgentRuntime,
  type AgentRuntimeFactory,
  CompositeContextManager,
  type CreatedManagedAgentRuntime,
  type CredentialProvider,
  createUpdatePlanTool,
  EventBus,
  FileWorkspaceMemoryStore,
  FileWorkspacePlanStore,
  grepTool,
  InMemorySessionStore,
  listDirectoryTool,
  type ManagedAgentMode,
  type ModelProvider,
  type RuntimeEvent,
  readFileTool,
  registerCoreTools,
  registerWebTools,
  searchFilesTool,
  type ToolApproval,
  ToolRegistry,
  WorkspaceMemoryContextProvider,
  WorkspacePlanContextProvider,
  type WorkspacePlanStore,
} from "@truss-harness/runtime";
import {
  type AgentProviderDescriptor,
  type AgentProviderRegistry,
  createDefaultAgentProviderRegistry,
  type ProviderConnectionOptions,
  type ProviderConnectionResult,
} from "./providers.js";

export type AgentMode = ManagedAgentMode;

export interface AgentCredentialResolver {
  resolve(
    reference: string,
    binding: AgentProviderBinding,
  ): Promise<CredentialProvider | undefined>;
}

export interface AgentHostOptions {
  readonly workspaceRoot: string;
  readonly systemPrompt?: string;
  readonly mcpServers?: McpServerConfigurations;
  readonly credentialResolver?: AgentCredentialResolver;
  readonly approvalFactory?: (
    profile: AgentProfile,
  ) => ToolApproval | undefined;
  /** Optional host-owned plan storage, used to isolate managed-agent plans from the primary client plan. */
  readonly planStoreFactory?: (profile: AgentProfile) => WorkspacePlanStore;
  readonly providerRegistry?: AgentProviderRegistry;
}

export interface HostedRuntime {
  readonly runtime: AgentRuntime;
  readonly events: EventBus<RuntimeEvent>;
  /** Live, credential-safe MCP lifecycle controls for trusted local clients. */
  readonly mcp: McpConnections;
  /** Compatibility snapshot accessor for clients that only render status. */
  readonly mcpServers: readonly McpServerStatus[];
  /** Present only when the host supplied an approval controller. */
  readonly approval?: ToolApproval;
  dispose(): Promise<void>;
}

export function systemPrompt(options: {
  readonly systemPrompt?: string;
  readonly mode: AgentMode;
}): string {
  return [
    options.systemPrompt,
    options.mode === "chat"
      ? "You are in Chat mode. Use the available read-only workspace tools when they would make an answer more accurate. You can inspect files and search the workspace, but you cannot make changes, run commands, or create or update plans. Answer conversationally and do not present a plan unless the user asks for one."
      : undefined,
    options.mode === "plan"
      ? "You are in Plan mode. Inspect the workspace with read-only tools as needed, then finish with a concise Markdown checklist exactly in this form: a heading '# Plan: <title>' followed by 3 to 8 actionable '- [ ] <step>' lines. Do not make changes."
      : undefined,
    options.mode === "edit"
      ? "You are an execution agent, not a planning assistant. Treat the user's message as a request to change the workspace even when it is phrased as a declaration. Before each tool call, emit one concise user-visible execution note inside <progress> and </progress>, for example <progress>Inspecting script.js</progress>. These notes must state only the immediate action, never private reasoning. Use tools for every workspace fact and every file change. Start with one relevant inspection tool call (read_file for a named file; search_files or list_directory otherwise). Use write_file with complete initial content only for a new or blank target file, and keep the content small enough to fit one tool call; for existing or large files, read first and use replace_in_file with one focused contiguous edit. Read every changed file to verify it. Do not answer with a proposal, status, or completion claim before tool calls. Never claim a file changed unless that write tool succeeded. If a tool fails, do not claim completion: for a file-write failure, reread the current file and retry the write with an exact contiguous excerpt before responding. Never stop after only rereading. Do not use the terminal to write files."
      : undefined,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function isApprovalController(
  value: ToolApproval | undefined,
): value is ToolApproval & AgentApprovalController {
  return Boolean(
    value &&
      "resolve" in value &&
      "denyAll" in value &&
      typeof value.resolve === "function" &&
      typeof value.denyAll === "function",
  );
}

/**
 * Builds isolated runtimes for agent profiles. Each call receives its own
 * tools, memory/context stores, session store, event bus, and MCP lifecycle.
 */
export class AgentHost {
  private readonly registry: AgentProviderRegistry;

  constructor(private readonly options: AgentHostOptions) {
    this.registry =
      options.providerRegistry ?? createDefaultAgentProviderRegistry();
  }

  listProviders(): readonly AgentProviderDescriptor[] {
    return this.registry.list();
  }

  async validateProfile(profile: AgentProfile): Promise<void> {
    await this.registry.validate(profile.provider, {
      credential: await this.resolveCredential(profile.provider),
    });
  }

  async testProviderConnection(
    binding: AgentProviderBinding,
    options?: ProviderConnectionOptions,
    credentialOverride?: CredentialProvider,
  ): Promise<ProviderConnectionResult> {
    return this.registry.testConnection(
      binding,
      {
        credential:
          credentialOverride ?? (await this.resolveCredential(binding)),
      },
      options,
    );
  }

  async createRuntime(profile: AgentProfile): Promise<HostedRuntime> {
    const credential = await this.resolveCredential(profile.provider);
    const provider = await this.registry.create(profile.provider, {
      credential,
    });
    return this.createRuntimeWithProvider(
      profile,
      provider,
      this.options.approvalFactory?.(profile),
    );
  }

  createRuntimeFactory(): AgentRuntimeFactory {
    return {
      validate: (profile) => this.validateProfile(profile),
      create: async (profile): Promise<CreatedManagedAgentRuntime> => {
        const hosted = await this.createRuntime(profile);
        return {
          runtime: hosted.runtime,
          events: hosted.events,
          ...(isApprovalController(hosted.approval)
            ? { approval: hosted.approval }
            : {}),
          dispose: hosted.dispose,
        };
      },
    };
  }

  private async resolveCredential(
    binding: AgentProviderBinding,
  ): Promise<CredentialProvider | undefined> {
    return binding.credentialRef
      ? this.options.credentialResolver?.resolve(binding.credentialRef, binding)
      : undefined;
  }

  private async createRuntimeWithProvider(
    profile: AgentProfile,
    provider: ModelProvider,
    approval?: ToolApproval,
  ): Promise<HostedRuntime> {
    const events = new EventBus<RuntimeEvent>();
    const tools = new ToolRegistry();
    const memory = new FileWorkspaceMemoryStore(this.options.workspaceRoot);
    const plans =
      this.options.planStoreFactory?.(profile) ??
      new FileWorkspacePlanStore(this.options.workspaceRoot);
    const usesReadOnlyWorkspaceTools =
      profile.mode === "chat" || profile.mode === "plan";
    if (profile.mode === "edit") {
      registerCoreTools(tools);
      tools.register(createUpdatePlanTool(plans));
    }
    if (usesReadOnlyWorkspaceTools) {
      tools.register(readFileTool);
      tools.register(listDirectoryTool);
      tools.register(searchFilesTool);
      tools.register(grepTool);
    }
    if (profile.internetAccess) registerWebTools(tools);
    const enabledMcpServers =
      profile.mode === "edit"
        ? this.options.mcpServers
        : usesReadOnlyWorkspaceTools
          ? Object.fromEntries(
              Object.entries(this.options.mcpServers ?? {}).filter(
                ([, server]) => server.readOnly,
              ),
            )
          : {};
    const mcp = await registerMcpServers(tools, enabledMcpServers, {
      workspaceRoot: this.options.workspaceRoot,
    });
    return {
      events,
      mcp,
      get mcpServers() {
        return mcp.statuses;
      },
      ...(approval ? { approval } : {}),
      dispose: () => mcp.close(),
      runtime: new AgentRuntime({
        provider,
        tools,
        sessions: new InMemorySessionStore(),
        context: new CompositeContextManager([
          new WorkspacePlanContextProvider(plans),
          new WorkspaceMemoryContextProvider(memory),
        ]),
        events,
        workspaceRoot: this.options.workspaceRoot,
        systemPrompt: systemPrompt({
          systemPrompt: [this.options.systemPrompt, profile.instructions]
            .filter(Boolean)
            .join("\n\n"),
          mode: profile.mode,
        }),
        approval,
        memory,
        plans,
        savePlanOnCompletion: profile.mode === "plan",
        requireWriteForEditIntent: profile.mode === "edit",
        deferTextUntilToolDecision: profile.mode === "edit",
      }),
    };
  }
}
