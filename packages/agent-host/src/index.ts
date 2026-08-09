import {
  cloudProviderDefinitions,
  createCloudModelProvider,
  createLocalModelProvider,
  isCloudProviderId,
  type CloudProviderId,
  type ModelProviderKind,
} from "@truss-harness/provider-openai-compatible";
import {
  parseMcpServerConfigurations,
  registerMcpServers,
  type McpConnections,
  type McpServerConfigurations,
  type McpServerStatus,
} from "@truss-harness/mcp";
import {
  AgentRuntime,
  ApiKeyCredential,
  CompositeContextManager,
  EventBus,
  FileWorkspaceMemoryStore,
  FileWorkspacePlanStore,
  InMemorySessionStore,
  ToolRegistry,
  WorkspaceMemoryContextProvider,
  WorkspacePlanContextProvider,
  createUpdatePlanTool,
  grepTool,
  listDirectoryTool,
  readFileTool,
  registerCoreTools,
  registerWebTools,
  searchFilesTool,
  type AgentApprovalController,
  type AgentProfile,
  type AgentProviderBinding,
  type AgentRuntimeFactory,
  type CredentialProvider,
  type CreatedManagedAgentRuntime,
  type ManagedAgentMode,
  type ModelProvider,
  type RuntimeEvent,
  type ToolApproval,
} from "@truss-harness/runtime";

export type AgentMode = ManagedAgentMode;

export interface AgentProviderDescriptor {
  readonly id: string;
  readonly label: string;
  readonly requiresCredential: boolean;
  readonly defaultEndpointUrl?: string;
}

export interface AgentProviderFactoryContext {
  readonly credential?: CredentialProvider;
}

export type ProviderConnectionStatus =
  | "connected"
  | "invalid_configuration"
  | "authentication_failed"
  | "payment_required"
  | "model_unavailable"
  | "rate_limited"
  | "network_error"
  | "provider_error";

export interface ProviderConnectionResult {
  readonly status: ProviderConnectionStatus;
  readonly providerId: string;
  readonly modelId: string;
  /** Safe for UI and logs; never includes a key or raw upstream response. */
  readonly message: string;
}

export interface ProviderConnectionOptions {
  /** Bounded because this is an interactive settings check, not an agent run. */
  readonly timeoutMs?: number;
}

/** A host-side factory. Runtime contracts never import these provider adapters. */
export interface AgentProviderFactory {
  readonly descriptor: AgentProviderDescriptor;
  validate(
    binding: AgentProviderBinding,
    context: AgentProviderFactoryContext,
  ): Promise<void>;
  create(
    binding: AgentProviderBinding,
    context: AgentProviderFactoryContext,
  ): Promise<ModelProvider>;
}

export class AgentProviderRegistry {
  private readonly factories = new Map<string, AgentProviderFactory>();

  register(factory: AgentProviderFactory): void {
    if (this.factories.has(factory.descriptor.id)) {
      throw new Error(
        `An agent provider factory is already registered for '${factory.descriptor.id}'.`,
      );
    }
    this.factories.set(factory.descriptor.id, factory);
  }

  get(id: string): AgentProviderFactory | undefined {
    return this.factories.get(id);
  }
  list(): readonly AgentProviderDescriptor[] {
    return [...this.factories.values()].map((factory) => factory.descriptor);
  }

  async validate(
    binding: AgentProviderBinding,
    context: AgentProviderFactoryContext,
  ): Promise<void> {
    const factory = this.get(binding.providerId);
    if (!factory)
      throw new Error(
        `No agent provider is registered for '${binding.providerId}'.`,
      );
    await factory.validate(binding, context);
  }

  async create(
    binding: AgentProviderBinding,
    context: AgentProviderFactoryContext,
  ): Promise<ModelProvider> {
    const factory = this.get(binding.providerId);
    if (!factory)
      throw new Error(
        `No agent provider is registered for '${binding.providerId}'.`,
      );
    await factory.validate(binding, context);
    return factory.create(binding, context);
  }

  async testConnection(
    binding: AgentProviderBinding,
    context: AgentProviderFactoryContext,
    options: ProviderConnectionOptions = {},
  ): Promise<ProviderConnectionResult> {
    const timeoutMs = options.timeoutMs ?? 15_000;
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const provider = await this.create(binding, context);
      let finished = false;
      for await (const event of provider.stream({
        messages: [{ role: "user", content: "Reply with exactly: OK" }],
        tools: [],
        signal: controller.signal,
      })) {
        if (event.type === "finish") finished = true;
      }
      if (!finished)
        throw new Error("Model response ended without completing the request.");
      return {
        status: "connected",
        providerId: binding.providerId,
        modelId: binding.modelId,
        message: "Connected successfully.",
      };
    } catch (error) {
      return providerConnectionFailure(binding, error, timedOut);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function providerConnectionFailure(
  binding: AgentProviderBinding,
  error: unknown,
  timedOut: boolean,
): ProviderConnectionResult {
  const raw = error instanceof Error ? error.message : String(error);
  const status = /\((\d{3})\)/.exec(raw)?.[1];
  const result = (
    connectionStatus: ProviderConnectionStatus,
    message: string,
  ): ProviderConnectionResult => ({
    status: connectionStatus,
    providerId: binding.providerId,
    modelId: binding.modelId,
    message,
  });
  if (timedOut)
    return result(
      "network_error",
      "The provider did not respond before the connection test timed out.",
    );
  if (status === "401" || status === "403")
    return result(
      "authentication_failed",
      "The provider rejected the configured API key.",
    );
  if (status === "402")
    return result(
      "payment_required",
      "The API key was accepted, but this account or key has insufficient credit.",
    );
  if (status === "404")
    return result(
      "model_unavailable",
      "The selected model is unavailable from this provider.",
    );
  if (status === "429")
    return result(
      "rate_limited",
      "The provider is rate limiting this account or model. Try again shortly.",
    );
  if (
    /requires (a model|a configured credential)|valid HTTP or HTTPS endpoint/i.test(
      raw,
    )
  )
    return result(
      "invalid_configuration",
      "Check the provider, endpoint, model ID, and API key configuration.",
    );
  if (/abort|fetch|network|ECONN|ENOTFOUND|timed out/i.test(raw))
    return result(
      "network_error",
      "Truss could not reach the provider endpoint.",
    );
  return result(
    "provider_error",
    "The provider could not complete the connection test.",
  );
}

function endpoint(
  binding: AgentProviderBinding,
  defaultEndpointUrl: string,
): string {
  return binding.endpointUrl?.trim() || defaultEndpointUrl;
}

function localProviderFactory(options: {
  readonly id: "ollama" | "openai-compatible" | "llama-cpp";
  readonly kind: "ollama" | "openai-compatible";
  readonly label: string;
  readonly defaultEndpointUrl: string;
}): AgentProviderFactory {
  const { id, kind, label, defaultEndpointUrl } = options;
  return {
    descriptor: {
      id,
      label,
      requiresCredential: false,
      defaultEndpointUrl,
    },
    async validate(binding) {
      if (!binding.modelId.trim())
        throw new Error(`${label} requires a model.`);
      const value = endpoint(binding, defaultEndpointUrl);
      try {
        const url = new URL(value);
        if (url.protocol !== "http:" && url.protocol !== "https:")
          throw new Error("unsupported protocol");
      } catch {
        throw new Error(`${label} requires a valid HTTP or HTTPS endpoint.`);
      }
    },
    async create(binding, context) {
      return createLocalModelProvider({
        kind,
        baseUrl: endpoint(binding, defaultEndpointUrl),
        model: binding.modelId,
        credential: context.credential,
      });
    },
  };
}

function cloudProviderFactory(
  id: CloudProviderId,
  label: string,
): AgentProviderFactory {
  return {
    descriptor: { id, label, requiresCredential: true },
    async validate(binding, context) {
      if (!binding.modelId.trim())
        throw new Error(`${label} requires a model.`);
      if (!context.credential)
        throw new Error(`${label} requires a configured credential.`);
    },
    async create(binding, context) {
      if (!isCloudProviderId(id) || !context.credential)
        throw new Error(`${label} requires a configured credential.`);
      return createCloudModelProvider({
        provider: id,
        model: binding.modelId,
        credential: context.credential,
      });
    },
  };
}

/** Current provider adapters, registered through a replaceable registry. */
export function createDefaultAgentProviderRegistry(): AgentProviderRegistry {
  const registry = new AgentProviderRegistry();
  registry.register(
    localProviderFactory({
      id: "ollama",
      kind: "ollama",
      label: "Ollama",
      defaultEndpointUrl: "http://localhost:11434",
    }),
  );
  registry.register(
    localProviderFactory({
      id: "openai-compatible",
      kind: "openai-compatible",
      label: "OpenAI-compatible",
      defaultEndpointUrl: "http://localhost:1234/v1",
    }),
  );
  registry.register(
    localProviderFactory({
      id: "llama-cpp",
      kind: "openai-compatible",
      label: "llama.cpp server",
      defaultEndpointUrl: "http://127.0.0.1:8080/v1",
    }),
  );
  for (const provider of cloudProviderDefinitions)
    registry.register(cloudProviderFactory(provider.id, provider.label));
  return registry;
}

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

function systemPrompt(options: {
  readonly systemPrompt?: string;
  readonly mode: AgentMode;
}): string {
  return [
    options.systemPrompt,
    options.mode === "plan"
      ? "You are in Plan mode. Inspect the workspace with read-only tools as needed, then finish with a concise Markdown checklist exactly in this form: a heading '# Plan: <title>' followed by 3 to 8 actionable '- [ ] <step>' lines. Do not make changes."
      : undefined,
    options.mode === "edit"
      ? "You are an execution agent, not a planning assistant. Treat the user's message as a request to change the workspace even when it is phrased as a declaration. Before each tool call, emit one concise user-visible execution note inside <progress> and </progress>, for example <progress>Inspecting script.js</progress>. These notes must state only the immediate action, never private reasoning. Use tools for every workspace fact and every file change. Start with one relevant inspection tool call (read_file for a named file; search_files or list_directory otherwise). Use write_file with complete initial content for a new or blank target file; use replace_in_file only for a focused edit to existing content. Read every changed file to verify it. Do not answer with a proposal, status, or completion claim before tool calls. Never claim a file changed unless that write tool succeeded. If a tool fails, do not claim completion: for a file-write failure, reread the current file and retry the write with an exact contiguous excerpt before responding. Never stop after only rereading. Do not use the terminal to write files."
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
    const plans = new FileWorkspacePlanStore(this.options.workspaceRoot);
    if (profile.mode === "edit") {
      registerCoreTools(tools);
      tools.register(createUpdatePlanTool(plans));
    }
    if (profile.mode === "plan") {
      tools.register(readFileTool);
      tools.register(listDirectoryTool);
      tools.register(searchFilesTool);
      tools.register(grepTool);
    }
    if (profile.internetAccess) registerWebTools(tools);
    const enabledMcpServers =
      profile.mode === "edit"
        ? this.options.mcpServers
        : profile.mode === "plan"
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

export { parseMcpServerConfigurations };
