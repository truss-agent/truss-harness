#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { cwd } from "node:process";
import { fileURLToPath } from "node:url";
import { brand } from "@truss-harness/branding";
import { FileAgentProfileStore } from "@truss-harness/cli/agents";
import {
  type ResolvedConfiguration,
  resolveConfiguration,
} from "@truss-harness/cli/config";
import {
  detectLocalEndpoints,
  isLocalEndpointKind,
  type LocalModelEndpoint,
  listLocalModels,
  type ModelProviderKind,
} from "@truss-harness/provider-openai-compatible";
import { render, useApp } from "ink";
import { useEffect, useMemo, useReducer, useState } from "react";
import {
  chatDisplayLines,
  configuredContextWindow,
  estimateTokens,
  visibleLines,
} from "./display.js";
import { useTuiInputController } from "./input-controller.js";
import { calculateLayout, focusReducer } from "./layout.js";
import { openExternalPreview } from "./processes.js";
import { useRuntimeSessionController } from "./runtime-session.js";
import { useTerminalController } from "./terminal-controller.js";
import { type TuiThemeName, tuiTheme } from "./theme.js";
import type { Screen, SettingsField } from "./types.js";
import { useWorkspaceFiles } from "./workspace-files.js";
import { TuiWorkspaceView } from "./workspace-view.js";

const tuiHelp = `${brand.productName} TUI

Full-screen terminal workspace for local coding models.

Usage:
  ${brand.tuiCommand}

The TUI starts in the current workspace and reads the same configuration
profiles as ${brand.cliCommand}. Press ? inside the TUI for its complete
keyboard-control reference.
`;

if (
  process.argv
    .slice(2)
    .some((argument) => argument === "--help" || argument === "-h")
) {
  process.stdout.write(tuiHelp);
  process.exit(0);
}

function ensureInteractiveTerminal(): void {
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function")
    return;

  // Git Bash exposes a pipe to Node for some console programs. winpty creates
  // the Windows console bridge Ink needs for keyboard input.
  if (
    process.platform === "win32" &&
    process.env.MSYSTEM &&
    process.env.TRUSS_TUI_WINPTY !== "1"
  ) {
    const result = spawnSync(
      "winpty",
      [
        process.execPath,
        fileURLToPath(import.meta.url),
        ...process.argv.slice(2),
      ],
      {
        stdio: "inherit",
        env: { ...process.env, TRUSS_TUI_WINPTY: "1" },
      },
    );
    if (!result.error) process.exit(result.status ?? 1);
  }

  process.stderr.write(
    brand.productName +
      " TUI needs an interactive terminal with raw keyboard input. Open PowerShell or Windows Terminal and run " +
      brand.tuiCommand +
      ", or run winpty " +
      brand.tuiCommand +
      " from Git Bash.\n",
  );
  process.exit(1);
}

ensureInteractiveTerminal();

function App({
  initialConfiguration,
}: {
  readonly initialConfiguration?: ResolvedConfiguration & {
    readonly tuiTheme?: TuiThemeName;
  };
}): React.ReactElement {
  const { exit } = useApp();
  const [viewport, setViewport] = useState(() => ({
    columns: process.stdout.columns || 120,
    rows: process.stdout.rows || 36,
  }));
  const workspaceRoot = useMemo(() => cwd(), []);
  const [focus, dispatchFocus] = useReducer(focusReducer, "chat");
  const [screen, setScreen] = useState<Screen>(
    initialConfiguration ? "workspace" : "settings",
  );
  const [endpoints, setEndpoints] = useState<readonly LocalModelEndpoint[]>([]);
  const [serverIndex, setServerIndex] = useState(0);
  const [models, setModels] = useState<readonly string[]>([]);
  const [agentProfiles, setAgentProfiles] = useState<
    readonly import("@truss-harness/runtime").AgentProfile[]
  >([]);
  const [modelIndex, setModelIndex] = useState(0);
  const [settingsField, setSettingsField] = useState<SettingsField>("server");
  const [themeName, setThemeName] = useState<TuiThemeName>(
    initialConfiguration?.tuiTheme ?? "forest",
  );
  const [endpointInput, setEndpointInput] = useState(
    initialConfiguration?.baseUrl ?? "http://127.0.0.1:11434",
  );
  const [modelInput, setModelInput] = useState(
    initialConfiguration?.model ?? "",
  );
  const [providerKind, setProviderKind] = useState<ModelProviderKind>(
    initialConfiguration?.provider ?? "ollama",
  );
  const [agentMode] = useState(initialConfiguration?.mode ?? "chat");
  const [permissionMode] = useState(initialConfiguration?.permission ?? "ask");
  const [internetAccess, setInternetAccess] = useState(
    initialConfiguration?.internetAccess ?? false,
  );
  const contextWindow = useMemo(configuredContextWindow, []);
  const theme = tuiTheme(themeName);
  const terminal = useTerminalController(workspaceRoot);
  const {
    terminalLines,
    terminalScroll,
    setTerminalScroll,
    commandInput,
    setCommandInput,
    previewUrl,
    appendTerminal,
    runTerminalInput,
    interruptProcess,
  } = terminal;
  const candidates = useMemo<readonly LocalModelEndpoint[]>(
    () => [
      ...endpoints,
      {
        id: "custom",
        label: "Custom compatible endpoint",
        kind: "openai-compatible",
        baseUrl: "",
      },
    ],
    [endpoints],
  );
  const selectedEndpoint =
    candidates[Math.min(serverIndex, Math.max(candidates.length - 1, 0))];
  const layout = useMemo(() => calculateLayout(viewport), [viewport]);
  const {
    terminalHeight,
    chatWidth,
    editorWidth,
    compactChatHeight,
    editorLineCount,
    overlayWidth,
  } = layout;
  const workspaceFiles = useWorkspaceFiles({
    workspaceRoot,
    viewportRows: viewport.rows,
    editorWidth,
    editorLineCount,
    focusEditor: () => dispatchFocus({ type: "select", focus: "editor" }),
    closeSearch: () => setScreen("workspace"),
  });
  const {
    fileIndex,
    setFileIndex,
    fileTree,
    selectedFileTreeEntry,
    fileSearchInput,
    setFileSearchInput,
    fileSearchIndex,
    setFileSearchIndex,
    fileSearchResults,
    openFilePath,
    editorTitle,
    setEditorScroll,
    editorRows,
    visibleEditorRows,
    fileTreeStart,
    visibleFileTree,
    loadFile,
    toggleDirectory,
    openSearchResult,
    toggleDiff,
  } = workspaceFiles;
  const runtimeSession = useRuntimeSessionController({
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
    showScreen: setScreen,
  });
  const {
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
  } = runtimeSession;
  const contextTokens = useMemo(
    () =>
      chat.reduce(
        (total, message) => total + estimateTokens(message.content),
        400,
      ),
    [chat],
  );
  const chatLineCount = Math.max(
    2,
    compactChatHeight - (activePlan ? 7 : 0) - 4,
  );
  const chatTranscript = chatDisplayLines(
    chat,
    busy,
    Math.max(12, chatWidth - 5),
  );
  const chatLines = visibleLines(chatTranscript, chatLineCount, chatScroll);
  const visibleTerminalLines = visibleLines(
    terminalLines,
    Math.max(1, terminalHeight - 4),
    terminalScroll,
  );

  useEffect(() => {
    void new FileAgentProfileStore(workspaceRoot)
      .list()
      .then(setAgentProfiles)
      .catch((error: unknown) =>
        appendTerminal(
          `[agents] ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
  }, [workspaceRoot, appendTerminal]);

  useEffect(() => {
    void detectLocalEndpoints().then((detected) => {
      setEndpoints(detected);
      const preferred = configuration
        ? detected.findIndex(
            (endpoint) =>
              endpoint.kind === configuration.provider &&
              endpoint.baseUrl === configuration.baseUrl,
          )
        : -1;
      if (preferred >= 0) setServerIndex(preferred);
    });
  }, [configuration]);

  useEffect(() => {
    const refreshViewport = (): void =>
      setViewport({
        columns: process.stdout.columns || 120,
        rows: process.stdout.rows || 36,
      });
    process.stdout.on("resize", refreshViewport);
    return () => {
      process.stdout.off("resize", refreshViewport);
    };
  }, []);

  useEffect(() => {
    if (
      !selectedEndpoint ||
      !endpointInput ||
      !isLocalEndpointKind(providerKind)
    )
      return;
    const endpoint: LocalModelEndpoint = {
      ...selectedEndpoint,
      kind: providerKind,
      baseUrl: endpointInput,
    };
    void listLocalModels(endpoint)
      .then((available) => setModels(available.map((model) => model.name)))
      .catch(() => setModels([]));
  }, [selectedEndpoint, endpointInput, providerKind]);

  useEffect(() => {
    const selected = models.indexOf(modelInput);
    setModelIndex(Math.max(0, selected));
  }, [models, modelInput]);

  const refreshAgentProfiles = (): void => {
    void new FileAgentProfileStore(workspaceRoot)
      .list()
      .then(setAgentProfiles)
      .catch((error: unknown) =>
        appendTerminal(
          `[agents] ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
  };
  const moveFocus = (direction: 1 | -1): void => {
    dispatchFocus({ type: direction === 1 ? "next" : "previous" });
  };
  const interruptOrExit = (): void => {
    if (interruptProcess()) return;
    if (busy) cancelRun();
    else exit();
  };
  const openPreview = (url: string): void => {
    try {
      openExternalPreview(url);
      appendTerminal(`[preview] Opened ${url}`);
    } catch (error) {
      appendTerminal(
        `[preview error] ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  useTuiInputController({
    state: {
      screen,
      focus,
      busy,
      fileSearchResults,
      fileSearchIndex,
      candidates,
      selectedEndpoint,
      settingsField,
      endpointInput,
      modelInput,
      models,
      modelIndex,
      configurationAvailable: Boolean(configuration),
      previewUrl,
      terminalLineCount: terminalLines.length,
      terminalHeight,
      commandInput,
      fileTree,
      selectedFileTreeEntry,
      editorRows,
      editorLineCount,
      chatTranscriptLength: chatTranscript.length,
      chatLineCount,
    },
    setters: {
      setScreen,
      setFileSearchInput,
      setFileSearchIndex,
      setSettingsField,
      setServerIndex,
      setProviderKind,
      setEndpointInput,
      setModelIndex,
      setModelInput,
      setInternetAccess,
      setThemeName,
      setTerminalScroll,
      setCommandInput,
      setFileIndex,
      setEditorScroll,
      setChatScroll,
      setChatInput,
    },
    actions: {
      interruptOrExit,
      cancelRun,
      resolveApproval,
      openSearchResult,
      refreshAgentProfiles,
      testMcpConnections,
      configureRuntime: () => void configureRuntime(),
      moveFocus,
      openPreview,
      runTerminalInput: (input) =>
        void runTerminalInput(input).catch((error: unknown) =>
          appendTerminal(`[terminal error] ${String(error)}`),
        ),
      startNewConversation,
      toggleDirectory,
      loadFile: (entry) => void loadFile(entry),
      toggleDiff: () => void toggleDiff(),
      sendPrompt: () => void sendPrompt(),
    },
  });

  return (
    <TuiWorkspaceView
      viewport={viewport}
      layout={layout}
      theme={theme}
      configuration={configuration}
      runStatus={runStatus}
      busy={busy}
      contextTokens={contextTokens}
      contextWindow={contextWindow}
      tokensPerSecond={tokensPerSecond}
      previewUrl={previewUrl}
      focus={focus}
      visibleFileTree={visibleFileTree}
      fileTreeLength={fileTree.length}
      fileTreeStart={fileTreeStart}
      fileIndex={fileIndex}
      openFilePath={openFilePath}
      editorTitle={editorTitle}
      visibleEditorRows={visibleEditorRows}
      activePlan={activePlan}
      chatLines={chatLines}
      chatScroll={chatScroll}
      chatInput={chatInput}
      visibleTerminalLines={visibleTerminalLines}
      commandInput={commandInput}
      sessionId={sessionId}
      overlays={{
        screen,
        overlayWidth,
        fileSearchInput,
        fileSearchResults,
        fileSearchIndex,
        settingsField,
        selectedEndpoint,
        endpointInput,
        modelInput,
        models,
        modelIndex,
        internetAccess,
        themeName,
        providerKind,
        pendingTool,
        agentProfiles,
        mcpStatuses,
      }}
    />
  );
}

const initialConfiguration = await resolveConfiguration({
  workspaceRoot: cwd(),
}).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("Set a model")) return undefined;
  throw error;
});
const application = render(<App initialConfiguration={initialConfiguration} />);
await application.waitUntilExit();
