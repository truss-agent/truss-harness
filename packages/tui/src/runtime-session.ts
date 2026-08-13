import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ResolvedConfiguration } from "@truss-harness/cli/config";
import {
  type ClientConfiguration,
  createClientRuntime,
} from "@truss-harness/cli/runtime";
import {
  cloudProviderDefinition,
  isCloudProviderId,
  type ModelProviderKind,
} from "@truss-harness/provider-openai-compatible";
import {
  type ContextBlock,
  executeWorkspaceCommand,
  FileWorkspacePlanStore,
  type ToolApproval,
  type ToolCall,
  type WorkspacePlan,
} from "@truss-harness/runtime";
import { useEffect, useRef, useState } from "react";
import { estimateTokens, truncate } from "./display.js";
import type { ChatMessage, RunStatus, Screen } from "./types.js";

export interface RuntimeSessionOptions {
  readonly initialConfiguration?: ResolvedConfiguration;
  readonly workspaceRoot: string;
  readonly providerKind: ModelProviderKind;
  readonly endpointInput: string;
  readonly modelInput: string;
  readonly agentMode: ClientConfiguration["mode"];
  readonly permissionMode: ResolvedConfiguration["permission"];
  readonly internetAccess: boolean;
  readonly openFilePath?: string;
  readonly contextWindow: number;
  readonly appendTerminal: (output: string) => void;
  readonly showScreen: (screen: Screen) => void;
}

export function useRuntimeSessionController({
  initialConfiguration,
  workspaceRoot,
  providerKind,
  endpointInput,
  modelInput,
  agentMode,
  permissionMode,
  internetAccess,
  openFilePath,
  contextWindow,
  appendTerminal,
  showScreen,
}: RuntimeSessionOptions) {
  const [configuration, setConfiguration] = useState<
    ClientConfiguration | undefined
  >(initialConfiguration);
  const [client, setClient] = useState<
    Awaited<ReturnType<typeof createClientRuntime>> | undefined
  >();
  const [mcpStatuses, setMcpStatuses] = useState<
    Awaited<ReturnType<typeof createClientRuntime>>["mcpServers"]
  >(() =>
    Object.entries(initialConfiguration?.mcpServers ?? {}).map(
      ([name, server]) => ({
        name,
        state: server.enabled === false ? "disabled" : "idle",
        toolCount: 0,
      }),
    ),
  );
  const [sessionId, setSessionId] = useState<string>();
  const [chatInput, setChatInput] = useState("");
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [chatScroll, setChatScroll] = useState(0);
  const [streamMetrics, setStreamMetrics] = useState({
    startedAt: 0,
    generatedTokens: 0,
  });
  const [busy, setBusy] = useState(false);
  const [runStatus, setRunStatus] = useState<RunStatus>("ready");
  const [activePlan, setActivePlan] = useState<WorkspacePlan>();
  const [pendingTool, setPendingTool] = useState<ToolCall>();
  const approvalResolvers = useRef(
    new Map<string, (approved: boolean) => void>(),
  );
  const abortController = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    void new FileWorkspacePlanStore(workspaceRoot)
      .load()
      .then(setActivePlan)
      .catch(() => undefined);
  }, [workspaceRoot]);

  useEffect(() => {
    if (!client) return;
    const unsubscribeMcp = client.mcp.subscribe((statuses) =>
      setMcpStatuses((current) => {
        const merged = new Map(current.map((status) => [status.name, status]));
        for (const status of statuses) merged.set(status.name, status);
        return [...merged.values()];
      }),
    );
    const unsubscribe = client.events.subscribe((event) => {
      if (event.type === "text_delta") {
        setRunStatus("thinking");
        setChatScroll(0);
        setStreamMetrics((current) =>
          current.startedAt
            ? {
                ...current,
                generatedTokens:
                  current.generatedTokens + estimateTokens(event.text),
              }
            : current,
        );
        setChat((current) => {
          const last = current.at(-1);
          if (last?.role !== "assistant")
            return [...current, { role: "assistant", content: event.text }];
          return [
            ...current.slice(0, -1),
            { role: "assistant", content: last.content + event.text },
          ];
        });
      }
      if (event.type === "tool_call_requested") {
        setRunStatus("tool");
        appendTerminal(
          `[tool requested] ${event.tool} ${JSON.stringify(event.input)}`,
        );
      }
      if (event.type === "tool_completed") {
        setRunStatus("thinking");
        appendTerminal(
          `[tool completed] ${event.tool}: ${truncate(event.result.content, 160)}`,
        );
      }
      if (event.type === "plan_updated") setActivePlan(event.plan);
      if (event.type === "run_failed") {
        setRunStatus("ready");
        appendTerminal(`[agent error] ${event.error.message}`);
      }
    });
    return () => {
      unsubscribe();
      unsubscribeMcp();
      void client.dispose();
    };
  }, [client, appendTerminal]);

  const configureRuntime = async (): Promise<void> => {
    if (!endpointInput.trim() || !modelInput.trim()) {
      appendTerminal("[configuration] An endpoint and model are required.");
      return;
    }
    const nextConfiguration: ClientConfiguration = {
      workspaceRoot,
      provider: providerKind,
      baseUrl: endpointInput.trim(),
      model: modelInput.trim(),
      apiKey:
        initialConfiguration?.provider === providerKind
          ? initialConfiguration.apiKey
          : (process.env.TRUSS_HARNESS_API_KEY ??
            (isCloudProviderId(providerKind)
              ? process.env[
                  cloudProviderDefinition(providerKind)
                    .apiKeyEnvironmentVariable
                ]
              : undefined)),
      systemPrompt: process.env.TRUSS_HARNESS_SYSTEM_PROMPT,
      mode: agentMode,
      internetAccess,
      mcpServers: initialConfiguration?.mcpServers,
      approval: {
        approve: async (call) => {
          const readOnly = [
            "read_file",
            "list_directory",
            "search_files",
            "grep",
          ].includes(call.name);
          if (
            permissionMode === "auto-all" ||
            (permissionMode === "auto-read" && readOnly)
          )
            return true;
          return new Promise<boolean>((resolve) => {
            approvalResolvers.current.set(call.id, resolve);
            setPendingTool(call);
            setRunStatus("waiting");
            showScreen("approval");
          });
        },
      } satisfies ToolApproval,
    };
    setConfiguration(nextConfiguration);
    setRunStatus("thinking");
    try {
      const nextClient = await createClientRuntime(nextConfiguration);
      setClient(nextClient);
      for (const server of nextClient.mcpServers) {
        appendTerminal(
          `[mcp] ${server.name}: ${server.state}${server.error ? ` (${server.error})` : ` (${server.toolCount} tools)`}`,
        );
      }
    } catch (error) {
      appendTerminal(
        `[mcp] Unable to configure runtime: ${error instanceof Error ? error.message : String(error)}`,
      );
      setRunStatus("ready");
      return;
    }
    setSessionId(undefined);
    setChat([]);
    setChatScroll(0);
    setStreamMetrics({ startedAt: 0, generatedTokens: 0 });
    showScreen("workspace");
    appendTerminal(
      `[configuration] ${nextConfiguration.provider} ${nextConfiguration.model} at ${nextConfiguration.baseUrl}`,
    );
    setRunStatus("ready");
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: startup configuration intentionally runs exactly once; subsequent changes are applied explicitly.
  useEffect(() => {
    if (initialConfiguration && !client) void configureRuntime();
  }, []);

  const openFileContext = async (): Promise<readonly ContextBlock[]> => {
    if (!openFilePath) return [];
    try {
      const maximumCharacters = Math.max(
        2_000,
        Math.min(20_000, contextWindow),
      );
      const content = await readFile(join(workspaceRoot, openFilePath), "utf8");
      const clipped = content.slice(0, maximumCharacters);
      return [
        {
          source: `active-file:${openFilePath}`,
          content: `This is the currently open workspace file and the primary context for this request. Tool results produced later in the run take precedence over this request-start snapshot.\n\n${clipped}`,
          priority: 1_000,
        },
      ];
    } catch {
      return [];
    }
  };

  const sendPrompt = async (): Promise<void> => {
    const prompt = chatInput.trim();
    if (!prompt || busy) return;
    const command = await executeWorkspaceCommand({
      workspaceRoot,
      input: prompt,
    });
    if (command.handled) {
      setChatInput("");
      setChat((current) => [
        ...current,
        { role: "user", content: prompt },
        { role: "assistant", content: command.message },
      ]);
      appendTerminal(
        `[workspace command] ${command.command ?? prompt}: ${command.ok ? "completed" : "failed"}`,
      );
      return;
    }
    if (!client) {
      showScreen("settings");
      appendTerminal(
        "[configuration] Select a local model before sending a prompt.",
      );
      return;
    }
    setChatInput("");
    setChatScroll(0);
    setBusy(true);
    setRunStatus("thinking");
    setStreamMetrics({ startedAt: Date.now(), generatedTokens: 0 });
    setChat((current) => [
      ...current,
      { role: "user", content: prompt },
      { role: "assistant", content: "" },
    ]);
    const controller = new AbortController();
    abortController.current = controller;
    try {
      const session = sessionId
        ? await client.runtime.getSession(sessionId)
        : await client.runtime.createSession();
      if (!session) throw new Error("Conversation is unavailable.");
      setSessionId(session.id);
      await client.runtime.run(
        session.id,
        prompt,
        controller.signal,
        await openFileContext(),
      );
    } catch (error) {
      if (!controller.signal.aborted)
        appendTerminal(
          `[agent error] ${error instanceof Error ? error.message : String(error)}`,
        );
    } finally {
      setBusy(false);
      setRunStatus("ready");
      abortController.current = undefined;
    }
  };

  const resolveApproval = (approved: boolean): void => {
    if (pendingTool) approvalResolvers.current.get(pendingTool.id)?.(approved);
    setPendingTool(undefined);
    setRunStatus(approved ? "thinking" : "ready");
    showScreen("workspace");
  };

  const startNewConversation = (): void => {
    if (busy) {
      appendTerminal(
        "[conversation] Stop the active run before starting a new conversation.",
      );
      return;
    }
    setSessionId(undefined);
    setChat([]);
    setChatInput("");
    setChatScroll(0);
    setStreamMetrics({ startedAt: 0, generatedTokens: 0 });
    appendTerminal("[conversation] Started a new conversation.");
  };

  const cancelRun = (): void => {
    abortController.current?.abort();
    setRunStatus("ready");
    appendTerminal("[agent] Cancellation requested.");
  };

  const testMcpConnections = (): void => {
    if (!configuration) return;
    void createClientRuntime({ ...configuration, mode: "edit" })
      .then(async (inspection) => {
        setMcpStatuses(inspection.mcpServers);
        appendTerminal("[mcp] Tested configured servers.");
        await inspection.dispose();
      })
      .catch((error: unknown) =>
        appendTerminal(
          `[mcp] ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
  };

  const tokensPerSecond =
    streamMetrics.startedAt && streamMetrics.generatedTokens
      ? streamMetrics.generatedTokens /
        Math.max((Date.now() - streamMetrics.startedAt) / 1_000, 0.1)
      : undefined;

  return {
    configuration,
    mcpStatuses,
    sessionId,
    chatInput,
    setChatInput,
    chat,
    chatScroll,
    setChatScroll,
    busy,
    runStatus,
    activePlan,
    pendingTool,
    tokensPerSecond,
    configureRuntime,
    sendPrompt,
    resolveApproval,
    startNewConversation,
    cancelRun,
    testMcpConnections,
  };
}
