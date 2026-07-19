import { createLocalModelProvider, type LocalEndpointKind } from "@truss-harness/provider-openai-compatible";
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
  type ToolApproval,
  type RuntimeEvent
} from "@truss-harness/runtime";

export type AgentMode = "chat" | "plan" | "edit";

export interface ClientRuntimeOptions {
  readonly workspaceRoot: string;
  readonly provider: LocalEndpointKind;
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey?: string;
  readonly systemPrompt?: string;
  readonly approval?: ToolApproval;
  readonly mode?: AgentMode;
  readonly internetAccess?: boolean;
}

export function createClientRuntime(options: ClientRuntimeOptions): {
  readonly runtime: AgentRuntime;
  readonly events: EventBus<RuntimeEvent>;
} {
  const events = new EventBus<RuntimeEvent>();
  const tools = new ToolRegistry();
  const memory = new FileWorkspaceMemoryStore(options.workspaceRoot);
  const plans = new FileWorkspacePlanStore(options.workspaceRoot);
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

  return {
    events,
    runtime: new AgentRuntime({
      provider: createLocalModelProvider({
        kind: options.provider,
        baseUrl: options.baseUrl,
        model: options.model,
        apiKey: options.apiKey
      }),
      tools,
      sessions: new InMemorySessionStore(),
      context: new CompositeContextManager([new WorkspacePlanContextProvider(plans), new WorkspaceMemoryContextProvider(memory)]),
      events,
      workspaceRoot: options.workspaceRoot,
      systemPrompt: [
        options.systemPrompt,
        mode === "plan" ? "You are in Plan mode. Inspect the workspace with read-only tools as needed, then finish with a concise Markdown checklist exactly in this form: a heading '# Plan: <title>' followed by 3 to 8 actionable '- [ ] <step>' lines. Do not make changes." : undefined,
        mode === "edit" ? "You have no direct filesystem access: tools are the only way to inspect or change the workspace. For a request to modify a file, use read_file as needed and then a successful write_file or replace_in_file call. The terminal is for builds, tests, Git, and inspection; never use shell redirection, echo, PowerShell content commands, or any terminal command to write source files. Never simulate tool calls, invent file contents, or claim that a file was created, changed, or verified unless that write tool completed successfully during this run. After a successful file write, read the file to verify it and then finish the task; do not write the same file again unless that verification shows a further focused change is required. If no write succeeds, say plainly that no file was changed and state why. When an active plan is present in context, use update_plan to mark a step in_progress before work and completed after verifying it. Keep the checklist accurate." : undefined
      ].filter(Boolean).join("\n\n"),
      approval: options.approval,
      memory,
      plans,
      savePlanOnCompletion: mode === "plan"
    })
  };
}

export interface ClientConfiguration extends ClientRuntimeOptions {}

export function configurationFromEnvironment(workspaceRoot: string, environment: NodeJS.ProcessEnv = process.env): ClientConfiguration {
  const provider = environment.TRUSS_HARNESS_PROVIDER === "openai-compatible" ? "openai-compatible" : "ollama";
  const mode = environment.TRUSS_HARNESS_AGENT_MODE === "edit" || environment.TRUSS_HARNESS_AGENT_MODE === "plan"
    ? environment.TRUSS_HARNESS_AGENT_MODE
    : "chat";
  const baseUrl = environment.TRUSS_HARNESS_BASE_URL ?? (provider === "ollama" ? "http://localhost:11434" : "http://localhost:1234/v1");
  const model = environment.TRUSS_HARNESS_MODEL;
  if (!model) {
    throw new Error("Set TRUSS_HARNESS_MODEL to the model name exposed by your OpenAI-compatible server.");
  }

  return {
    workspaceRoot,
    provider,
    baseUrl,
    model,
    apiKey: environment.TRUSS_HARNESS_API_KEY,
    systemPrompt: environment.TRUSS_HARNESS_SYSTEM_PROMPT,
    mode,
    internetAccess: environment.TRUSS_HARNESS_INTERNET_ACCESS === "true" || environment.TRUSS_HARNESS_INTERNET_ACCESS === "1"
  };
}
