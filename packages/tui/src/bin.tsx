#!/usr/bin/env node
import { spawn } from "node:child_process";
import { execFile as execFileCallback } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { cwd } from "node:process";
import { promisify } from "node:util";
import { Box, render, Text, useApp, useInput } from "ink";
import { useEffect, useMemo, useRef, useState } from "react";
import { detectLocalEndpoints, listLocalModels, type LocalEndpointKind, type LocalModelEndpoint } from "@truss-harness/provider-openai-compatible";
import { brand } from "@truss-harness/branding";
import { resolveConfiguration, type ResolvedConfiguration } from "@truss-harness/cli/config";
import { createClientRuntime, type ClientConfiguration } from "@truss-harness/cli/runtime";
import { executeWorkspaceCommand, FileWorkspacePlanStore, workspaceCommandHelp, type ToolApproval, type ToolCall, type WorkspacePlan } from "@truss-harness/runtime";

const execFile = promisify(execFileCallback);
const ignoredDirectories = new Set([".git", "node_modules", "dist", "coverage"]);
const focusOrder = ["files", "editor", "chat", "terminal"] as const;
type Focus = (typeof focusOrder)[number];
type Screen = "workspace" | "settings" | "approval" | "command" | "help";
type SettingsField = "server" | "endpoint" | "model";
type ChatMessage = { readonly role: "user" | "assistant"; readonly content: string };
type ChatDisplayLine = { readonly role: ChatMessage["role"]; readonly text: string; readonly header: boolean };

interface FileEntry {
  readonly path: string;
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, Math.max(0, length - 3))}...`;
}

function lines(value: string, count: number, width = 88): string[] {
  return value.split(/\r?\n/).slice(0, count).map((line) => truncate(line, width));
}

function estimateTokens(value: string): number {
  const trimmed = value.trim();
  return trimmed ? Math.ceil(trimmed.length / 4) : 0;
}

function formatTokenCount(value: number): string {
  if (value < 1_000) return String(Math.round(value));
  return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k`;
}

function wrapText(value: string, width: number): string[] {
  const result: string[] = [];
  for (const sourceLine of value.split(/\r?\n/)) {
    let remaining = sourceLine || " ";
    while (remaining.length > width) {
      const breakAt = Math.max(1, remaining.lastIndexOf(" ", width));
      result.push(remaining.slice(0, breakAt).trimEnd());
      remaining = remaining.slice(breakAt).trimStart();
    }
    result.push(remaining);
  }
  return result;
}

function chatDisplayLines(messages: readonly ChatMessage[], busy: boolean, width: number, limit: number): readonly ChatDisplayLine[] {
  const transcript = messages.flatMap((message) => {
    const content = message.content || (busy && message.role === "assistant" ? "Thinking..." : "");
    return [
      { role: message.role, text: message.role === "user" ? "YOU" : "AGENT", header: true },
      ...wrapText(content, width).map((text) => ({ role: message.role, text, header: false }))
    ];
  });
  return transcript.slice(-limit);
}

function configuredContextWindow(): number {
  const configured = Number.parseInt(process.env.TRUSS_HARNESS_CONTEXT_WINDOW ?? "8192", 10);
  return Number.isFinite(configured) ? Math.max(512, Math.min(1_000_000, configured)) : 8_192;
}

async function collectFiles(root: string, current = root, result: FileEntry[] = []): Promise<FileEntry[]> {
  if (result.length >= 160) return result;
  for (const entry of await readdir(current, { withFileTypes: true })) {
    if (result.length >= 160) break;
    if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) await collectFiles(root, join(current, entry.name), result);
    if (entry.isFile()) result.push({ path: relative(root, join(current, entry.name)) });
  }
  return result.sort((left, right) => left.path.localeCompare(right.path));
}

async function runCommand(command: string, workspaceRoot: string, onOutput: (output: string) => void): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, { cwd: workspaceRoot, shell: true, windowsHide: true });
    child.stdout.on("data", (data: Buffer) => onOutput(data.toString()));
    child.stderr.on("data", (data: Buffer) => onOutput(data.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      onOutput(`\n[process exited: ${code ?? "unknown"}]\n`);
      resolve();
    });
  });
}

function Panel({ title, active, children }: { readonly title: string; readonly active: boolean; readonly children: React.ReactNode }): React.ReactElement {
  return <Box flexDirection="column" borderStyle="round" borderColor={active ? "cyan" : "gray"} paddingX={1} width="100%" height="100%" overflow="hidden">
    <Text color={active ? "cyan" : "gray"} bold>{title}</Text>
    {children}
  </Box>;
}

function App({ initialConfiguration }: { readonly initialConfiguration?: ResolvedConfiguration }): React.ReactElement {
  const { exit } = useApp();
  const [viewport, setViewport] = useState(() => ({ columns: process.stdout.columns || 120, rows: process.stdout.rows || 36 }));
  const workspaceRoot = useMemo(() => cwd(), []);
  const [configuration, setConfiguration] = useState<ClientConfiguration | undefined>(initialConfiguration);
  const [client, setClient] = useState<ReturnType<typeof createClientRuntime> | undefined>();
  const [sessionId, setSessionId] = useState<string>();
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [fileIndex, setFileIndex] = useState(0);
  const [editor, setEditor] = useState("Select a file from the workspace tree.");
  const [editorTitle, setEditorTitle] = useState("Preview");
  const [isDiff, setIsDiff] = useState(false);
  const [focus, setFocus] = useState<Focus>("chat");
  const [screen, setScreen] = useState<Screen>(initialConfiguration ? "workspace" : "settings");
  const [chatInput, setChatInput] = useState("");
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [streamMetrics, setStreamMetrics] = useState({ startedAt: 0, generatedTokens: 0 });
  const [terminalLines, setTerminalLines] = useState<string[]>(["Terminal ready. Press ! in the terminal pane to run a workspace command."]);
  const [busy, setBusy] = useState(false);
  const [activePlan, setActivePlan] = useState<WorkspacePlan | undefined>();
  const [pendingTool, setPendingTool] = useState<ToolCall>();
  const [commandInput, setCommandInput] = useState("");
  const [endpoints, setEndpoints] = useState<readonly LocalModelEndpoint[]>([]);
  const [serverIndex, setServerIndex] = useState(0);
  const [models, setModels] = useState<readonly string[]>([]);
  const [modelIndex, setModelIndex] = useState(0);
  const [settingsField, setSettingsField] = useState<SettingsField>("server");
  const [endpointInput, setEndpointInput] = useState(initialConfiguration?.baseUrl ?? "http://127.0.0.1:11434");
  const [modelInput, setModelInput] = useState(initialConfiguration?.model ?? "");
  const [providerKind, setProviderKind] = useState<LocalEndpointKind>(initialConfiguration?.provider ?? "ollama");
  const [agentMode] = useState(initialConfiguration?.mode ?? "chat");
  const [permissionMode] = useState(initialConfiguration?.permission ?? "ask");
  const approvalResolvers = useRef(new Map<string, (approved: boolean) => void>());
  const abortController = useRef<AbortController | undefined>(undefined);
  const contextWindow = useMemo(configuredContextWindow, []);
  const contextTokens = useMemo(() => chat.reduce((total, message) => total + estimateTokens(message.content), 400), [chat]);
  const tokensPerSecond = streamMetrics.startedAt && streamMetrics.generatedTokens
    ? streamMetrics.generatedTokens / Math.max((Date.now() - streamMetrics.startedAt) / 1_000, 0.1)
    : undefined;

  const appendTerminal = (output: string): void => {
    const next = output.replace(/\r/g, "").split("\n").filter(Boolean);
    if (!next.length) return;
    setTerminalLines((current) => [...current, ...next].slice(-110));
  };
  const candidates = useMemo<readonly LocalModelEndpoint[]>(() => [
    ...endpoints,
    { id: "custom", label: "Custom compatible endpoint", kind: "openai-compatible", baseUrl: "" }
  ], [endpoints]);
  const selectedEndpoint = candidates[Math.min(serverIndex, Math.max(candidates.length - 1, 0))];
  const terminalHeight = Math.max(7, Math.min(11, Math.floor(viewport.rows * 0.24)));
  const workspaceHeight = Math.max(9, viewport.rows - terminalHeight - 6);
  const filesWidth = Math.max(20, Math.min(36, Math.floor(viewport.columns * 0.24)));
  const chatWidth = Math.max(28, Math.min(48, Math.floor(viewport.columns * 0.31)));
  const editorWidth = Math.max(30, viewport.columns - filesWidth - chatWidth - 4);
  const paneLines = Math.max(3, workspaceHeight - 4);
  const chatLines = chatDisplayLines(chat, busy, Math.max(12, chatWidth - 5), Math.max(2, paneLines - (activePlan ? 5 : 0) - 1));

  useEffect(() => {
    void collectFiles(workspaceRoot).then(setFiles).catch((error: unknown) => setEditor(`Unable to list workspace files: ${String(error)}`));
    void new FileWorkspacePlanStore(workspaceRoot).load().then(setActivePlan).catch(() => undefined);
    void detectLocalEndpoints().then((detected) => {
      setEndpoints(detected);
      const preferred = configuration ? detected.findIndex((endpoint) => endpoint.kind === configuration.provider && endpoint.baseUrl === configuration.baseUrl) : -1;
      if (preferred >= 0) setServerIndex(preferred);
    });
  }, [workspaceRoot]);

  useEffect(() => {
    const refreshViewport = (): void => setViewport({ columns: process.stdout.columns || 120, rows: process.stdout.rows || 36 });
    process.stdout.on("resize", refreshViewport);
    return () => { process.stdout.off("resize", refreshViewport); };
  }, []);

  useEffect(() => {
    if (!selectedEndpoint || !endpointInput) return;
    const endpoint: LocalModelEndpoint = { ...selectedEndpoint, kind: providerKind, baseUrl: endpointInput };
    void listLocalModels(endpoint).then((available) => {
      setModels(available.map((model) => model.name));
      const selected = available.findIndex((model) => model.name === modelInput);
      setModelIndex(Math.max(0, selected));
    }).catch(() => setModels([]));
  }, [selectedEndpoint?.id, endpointInput, providerKind]);

  useEffect(() => {
    if (!client) return;
    return client.events.subscribe((event) => {
      if (event.type === "text_delta") {
        setStreamMetrics((current) => current.startedAt
          ? { ...current, generatedTokens: current.generatedTokens + estimateTokens(event.text) }
          : current);
        setChat((current) => {
          const last = current.at(-1);
          if (!last || last.role !== "assistant") return [...current, { role: "assistant", content: event.text }];
          return [...current.slice(0, -1), { role: "assistant", content: last.content + event.text }];
        });
      }
      if (event.type === "tool_call_requested") appendTerminal(`[tool requested] ${event.tool} ${JSON.stringify(event.input)}`);
      if (event.type === "tool_completed") appendTerminal(`[tool completed] ${event.tool}: ${truncate(event.result.content, 160)}`);
      if (event.type === "plan_updated") setActivePlan(event.plan);
      if (event.type === "run_failed") appendTerminal(`[agent error] ${event.error.message}`);
    });
  }, [client]);

  const loadFile = async (entry: FileEntry): Promise<void> => {
    try {
      setIsDiff(false);
      setEditorTitle(entry.path);
      setEditor(await readFile(join(workspaceRoot, entry.path), "utf8"));
    } catch (error) {
      setEditor(`Unable to read ${entry.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const toggleDiff = async (): Promise<void> => {
    const entry = files[fileIndex];
    if (!entry) return;
    if (isDiff) return void loadFile(entry);
    try {
      const { stdout } = await execFile("git", ["diff", "--no-ext-diff", "--", entry.path], { cwd: workspaceRoot, maxBuffer: 1_000_000 });
      setEditorTitle(`Diff: ${entry.path}`);
      setEditor(stdout || "No working-tree diff for this file.");
      setIsDiff(true);
    } catch (error) {
      setEditor(`Unable to load Git diff: ${error instanceof Error ? error.message : String(error)}`);
      setIsDiff(true);
    }
  };
  const configureRuntime = (): void => {
    if (!endpointInput.trim() || !modelInput.trim()) {
      appendTerminal("[configuration] An endpoint and model are required.");
      return;
    }
    const nextConfiguration: ClientConfiguration = {
      workspaceRoot,
      provider: providerKind,
      baseUrl: endpointInput.trim(),
      model: modelInput.trim(),
      apiKey: process.env.TRUSS_HARNESS_API_KEY,
      systemPrompt: process.env.TRUSS_HARNESS_SYSTEM_PROMPT,
      mode: agentMode,
      approval: {
        approve: async (call) => {
          const readOnly = ["read_file", "list_directory", "search_files", "grep"].includes(call.name);
          if (permissionMode === "auto-all" || (permissionMode === "auto-read" && readOnly)) return true;
          return new Promise<boolean>((resolve) => {
          approvalResolvers.current.set(call.id, resolve);
          setPendingTool(call);
          setScreen("approval");
          });
        }
      } satisfies ToolApproval
    };
    setConfiguration(nextConfiguration);
    setClient(createClientRuntime(nextConfiguration));
    setSessionId(undefined);
    setChat([]);
    setStreamMetrics({ startedAt: 0, generatedTokens: 0 });
    setScreen("workspace");
    appendTerminal(`[configuration] ${nextConfiguration.provider} ${nextConfiguration.model} at ${nextConfiguration.baseUrl}`);
  };
  useEffect(() => {
    if (initialConfiguration && !client) configureRuntime();
  }, []);
  const sendPrompt = async (): Promise<void> => {
    const prompt = chatInput.trim();
    if (!prompt || busy) return;
    const command = await executeWorkspaceCommand({ workspaceRoot, input: prompt });
    if (command.handled) {
      setChatInput("");
      setChat((current) => [...current, { role: "user", content: prompt }, { role: "assistant", content: command.message }]);
      appendTerminal(`[workspace command] ${command.command ?? prompt}: ${command.ok ? "completed" : "failed"}`);
      return;
    }
    if (!client) {
      setScreen("settings");
      appendTerminal("[configuration] Select a local model before sending a prompt.");
      return;
    }
    setChatInput("");
    setBusy(true);
    setStreamMetrics({ startedAt: Date.now(), generatedTokens: 0 });
    setChat((current) => [...current, { role: "user", content: prompt }, { role: "assistant", content: "" }]);
    const controller = new AbortController();
    abortController.current = controller;
    try {
      const session = sessionId ? await client.runtime.getSession(sessionId) : await client.runtime.createSession();
      if (!session) throw new Error("Conversation is unavailable.");
      setSessionId(session.id);
      await client.runtime.run(session.id, prompt, controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) appendTerminal(`[agent error] ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
      abortController.current = undefined;
    }
  };
  const resolveApproval = (approved: boolean): void => {
    if (pendingTool) approvalResolvers.current.get(pendingTool.id)?.(approved);
    setPendingTool(undefined);
    setScreen("workspace");
  };
  const startNewConversation = (): void => {
    if (busy) {
      appendTerminal("[conversation] Stop the active run before starting a new conversation.");
      return;
    }
    setSessionId(undefined);
    setChat([]);
    setChatInput("");
    setStreamMetrics({ startedAt: 0, generatedTokens: 0 });
    appendTerminal("[conversation] Started a new conversation.");
  };
  const runTerminalInput = async (input: string): Promise<void> => {
    const command = await executeWorkspaceCommand({ workspaceRoot, input });
    if (command.handled) {
      appendTerminal(`[workspace command] ${command.command ?? input}: ${command.ok ? "completed" : "failed"}`);
      return;
    }

    await runCommand(input, workspaceRoot, appendTerminal);
  };

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      if (busy) abortController.current?.abort();
      else exit();
      return;
    }
    if (screen === "approval") {
      if (input.toLowerCase() === "y" || key.return) resolveApproval(true);
      if (input.toLowerCase() === "n" || key.escape) resolveApproval(false);
      return;
    }
    if (screen === "help") {
      setScreen("workspace");
      return;
    }
    if (screen === "settings") {
      if (key.escape) { setScreen("workspace"); return; }
      if (key.tab) { setSettingsField((current) => current === "server" ? "endpoint" : current === "endpoint" ? "model" : "server"); return; }
      if (settingsField === "server") {
        if (key.upArrow) setServerIndex((current) => Math.max(0, current - 1));
        if (key.downArrow) setServerIndex((current) => Math.min(candidates.length - 1, current + 1));
        if (key.return && selectedEndpoint) {
          setProviderKind(selectedEndpoint.kind);
          setEndpointInput(selectedEndpoint.baseUrl);
          setSettingsField("model");
        }
        return;
      }
      if (settingsField === "model") {
        if (key.upArrow) setModelIndex((current) => Math.max(0, current - 1));
        if (key.downArrow) setModelIndex((current) => Math.min(models.length - 1, current + 1));
        if (models[modelIndex] && (key.return || key.rightArrow)) setModelInput(models[modelIndex]);
      }
      if (key.return && endpointInput && modelInput) { configureRuntime(); return; }
      const setter = settingsField === "endpoint" ? setEndpointInput : setModelInput;
      if (key.backspace || key.delete) setter((current) => current.slice(0, -1));
      else if (!key.return && input) setter((current) => current + input);
      return;
    }
    if (screen === "command") {
      if (key.escape) { setScreen("workspace"); setCommandInput(""); return; }
      if (key.return) {
        const command = commandInput.trim();
        setCommandInput("");
        setScreen("workspace");
        if (command) void runTerminalInput(command).catch((error: unknown) => appendTerminal(`[terminal error] ${String(error)}`));
        return;
      }
      if (key.backspace || key.delete) setCommandInput((current) => current.slice(0, -1));
      else if (input) setCommandInput((current) => current + input);
      return;
    }
    if (key.tab) {
      setFocus((current) => focusOrder[(focusOrder.indexOf(current) + 1) % focusOrder.length]);
      return;
    }
    if (key.escape && busy) { abortController.current?.abort(); return; }
    if (input === "?" && focus !== "chat") { setScreen("help"); return; }
    if (input === "m" && focus !== "chat") { setScreen("settings"); return; }
    if (input === "n" && focus !== "chat") { startNewConversation(); return; }
    if (focus === "files") {
      if (key.upArrow) setFileIndex((current) => Math.max(0, current - 1));
      if (key.downArrow) setFileIndex((current) => Math.min(Math.max(files.length - 1, 0), current + 1));
      if (key.return && files[fileIndex]) void loadFile(files[fileIndex]);
      return;
    }
    if (focus === "editor") {
      if (input === "d") void toggleDiff();
      return;
    }
    if (focus === "terminal") {
      if (input === "!") setScreen("command");
      return;
    }
    if (key.return) { void sendPrompt(); return; }
    if (key.backspace || key.delete) setChatInput((current) => current.slice(0, -1));
    else if (input) setChatInput((current) => current + input);
  });

  return <Box flexDirection="column" height={viewport.rows} paddingX={1} overflow="hidden">
    <Box height={1} justifyContent="space-between" marginBottom={1}>
      <Text bold color="cyan">{brand.productName.toUpperCase()}</Text>
      <Text color="gray">{configuration ? `${configuration.provider} / ${configuration.model}` : "No model selected"}</Text>
      <Text color={busy ? "yellow" : "green"}>{busy ? "STREAMING" : "READY"}</Text>
    </Box>
    <Box height={1} justifyContent="space-between" marginBottom={1}>
      <Text color="gray">CONTEXT <Text color={contextTokens / contextWindow >= 0.9 ? "red" : contextTokens / contextWindow >= 0.7 ? "yellow" : "cyan"}>{formatTokenCount(contextTokens)} / {formatTokenCount(contextWindow)}</Text> estimated</Text>
      <Text color="gray">SPEED <Text color={busy ? "green" : "gray"}>{tokensPerSecond ? `${tokensPerSecond.toFixed(1)} tok/s` : "-- tok/s"}</Text></Text>
    </Box>
    <Box height={workspaceHeight} flexDirection="row" gap={1} overflow="hidden">
      <Box width={filesWidth} height="100%"><Panel title="FILES  [Tab]" active={focus === "files"}>
        {files.slice(Math.max(0, fileIndex - Math.floor(paneLines / 2)), fileIndex + Math.ceil(paneLines / 2)).map((entry) => <Text key={entry.path} wrap="truncate-end" color={files[fileIndex]?.path === entry.path ? "cyan" : undefined}>{files[fileIndex]?.path === entry.path ? "> " : "  "}{truncate(entry.path, Math.max(8, filesWidth - 6))}</Text>)}
      </Panel></Box>
      <Box width={editorWidth} height="100%"><Panel title={`${editorTitle}  [d] diff`} active={focus === "editor"}>
        {lines(editor, paneLines, Math.max(12, editorWidth - 7)).map((line, index) => <Text key={`${index}-${line}`} wrap="truncate-end" color={isDiff ? (line.startsWith("+") ? "green" : line.startsWith("-") ? "red" : undefined) : undefined}>{String(index + 1).padStart(3)} {line}</Text>)}
      </Panel></Box>
      <Box width={chatWidth} height="100%"><Panel title="AGENT  [Enter] send" active={focus === "chat"}>
        {activePlan && <Box flexDirection="column" marginBottom={1}><Text bold color="cyan" wrap="truncate-end">PLAN: {truncate(activePlan.title, Math.max(8, chatWidth - 9))}</Text>{activePlan.steps.slice(0, 3).map((step) => <Text key={step.id} wrap="truncate-end" color={step.status === "completed" ? "green" : step.status === "in_progress" ? "yellow" : "gray"}>{step.status === "completed" ? "[x]" : step.status === "in_progress" ? "[..]" : "[ ]"} {truncate(step.content, Math.max(8, chatWidth - 7))}</Text>)}</Box>}
        {chatLines.map((line, index) => <Text key={`${line.role}-${line.header}-${index}-${line.text}`} color={line.role === "user" ? "cyan" : "green"} bold={line.header}>{line.text}</Text>)}
        <Box flexGrow={1} />
        <Box><Text wrap="truncate-end" color={focus === "chat" ? "cyan" : "gray"}>{focus === "chat" ? "> " : "  "}{truncate(chatInput || "Ask about this workspace", Math.max(12, chatWidth - 5))}</Text></Box>
      </Panel></Box>
    </Box>
    <Box height={terminalHeight} marginTop={1}><Panel title="TERMINAL  [Tab then !]" active={focus === "terminal"}>
      {terminalLines.slice(-Math.max(2, terminalHeight - 3)).map((line, index) => <Text key={`${index}-${line}`} wrap="truncate-end" color={line.startsWith("[agent error]") || line.startsWith("[terminal error]") ? "red" : line.startsWith("[tool") ? "yellow" : "gray"}>{truncate(line, Math.max(20, viewport.columns - 8))}</Text>)}
    </Panel></Box>
    <Box height={1} marginTop={1} justifyContent="space-between"><Text color="gray" wrap="truncate-end">Tab focus  |  n new chat  |  m model  |  d diff  |  ! shell  |  ? help  |  Esc stop  |  Ctrl+C exit</Text><Text color="gray">{sessionId ? `session ${sessionId.slice(0, 8)}` : "new session"}</Text></Box>
    {screen === "settings" && <Box position="absolute" flexDirection="column" borderStyle="double" borderColor="cyan" paddingX={2} paddingY={1} width={90} marginLeft={4} marginTop={3} backgroundColor="black">
      <Text bold color="cyan">LOCAL MODEL CONFIGURATION</Text>
      <Text color="gray">Tab changes fields. Enter selects an item or saves when endpoint and model are set.</Text>
      <Text color={settingsField === "server" ? "cyan" : undefined}>SERVER: {selectedEndpoint?.label ?? "Scanning local servers..."}</Text>
      <Text color={settingsField === "endpoint" ? "cyan" : undefined}>ENDPOINT: {endpointInput}</Text>
      <Text color={settingsField === "model" ? "cyan" : undefined}>MODEL: {modelInput || models[modelIndex] || "Choose or type a model"}</Text>
      <Text color="gray">Detected models: {models.slice(0, 5).join(", ") || "none; type one manually"}</Text>
      <Text color="yellow">Provider: {providerKind}. Use the server selector for Ollama or compatible endpoints.</Text>
    </Box>}
    {screen === "approval" && <Box position="absolute" flexDirection="column" borderStyle="double" borderColor="yellow" paddingX={2} paddingY={1} width={90} marginLeft={4} marginTop={8} backgroundColor="black">
      <Text bold color="yellow">TOOL APPROVAL REQUIRED</Text>
      <Text>{pendingTool?.name} {JSON.stringify(pendingTool?.input)}</Text>
      <Text color="gray">Press Y or Enter to allow. Press N or Escape to deny.</Text>
    </Box>}
    {screen === "command" && <Box position="absolute" flexDirection="column" borderStyle="double" borderColor="cyan" paddingX={2} paddingY={1} width={90} marginLeft={4} marginTop={12} backgroundColor="black">
      <Text bold color="cyan">RUN WORKSPACE COMMAND</Text>
      <Text>{"> "}{commandInput}</Text>
      <Text color="gray">Enter runs it in the workspace root. Escape cancels.</Text>
    </Box>}
    {screen === "help" && <Box position="absolute" flexDirection="column" borderStyle="double" borderColor="cyan" paddingX={2} paddingY={1} width={90} marginLeft={4} marginTop={7} backgroundColor="black">
      <Text bold color="cyan">WORKSPACE COMMANDS</Text>
      {workspaceCommandHelp().split("\n").slice(1).map((line) => <Text key={line}>{line}</Text>)}
      <Text color="gray">Type a slash command in the Agent pane. Press any key to close.</Text>
    </Box>}
  </Box>;
}

const initialConfiguration = await resolveConfiguration({ workspaceRoot: cwd() }).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("Set a model")) return undefined;
  throw error;
});
const application = render(<App initialConfiguration={initialConfiguration} />);
await application.waitUntilExit();
