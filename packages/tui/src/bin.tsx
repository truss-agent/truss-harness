#!/usr/bin/env node
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { execFile as execFileCallback } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { cwd } from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Box, render, Text, useApp, useInput } from "ink";
import { useEffect, useMemo, useRef, useState } from "react";
import { detectLocalEndpoints, listLocalModels, type LocalEndpointKind, type LocalModelEndpoint } from "@truss-harness/provider-openai-compatible";
import { brand } from "@truss-harness/branding";
import { resolveConfiguration, type ResolvedConfiguration } from "@truss-harness/cli/config";
import { createClientRuntime, type ClientConfiguration } from "@truss-harness/cli/runtime";
import { executeWorkspaceCommand, FileWorkspacePlanStore, workspaceCommandHelp, type ContextBlock, type ToolApproval, type ToolCall, type WorkspacePlan } from "@truss-harness/runtime";
import { buildFileTree, fuzzyFiles, syntaxTokens, wrapSyntaxTokens, type FileEntry, type SyntaxToken } from "./file-browser.js";
import { tuiTheme, tuiThemeNames, type TuiTheme, type TuiThemeName } from "./theme.js";

const tuiHelp = `${brand.productName} TUI

Full-screen terminal workspace for local coding models.

Usage:
  ${brand.tuiCommand}

The TUI starts in the current workspace and reads the same configuration
profiles as ${brand.cliCommand}. Press ? inside the TUI for its complete
keyboard-control reference.
`;

const tuiControlHelp = [
  ["NAVIGATION", "Tab / Shift+Tab move focus; Ctrl+Left / Ctrl+Right move to an adjacent pane."],
  ["FILES", "/ opens fuzzy file search; Up/Down select; Left/Right collapse or expand; Enter opens."],
  ["EDITOR", "Up/Down scroll; d toggles Git diff; o opens the detected preview URL externally."],
  ["AGENT", "Enter sends; Up/Down scroll chat; n starts a new conversation outside the chat input."],
  ["TERMINAL", "Type directly and press Enter; Up/Down scroll output; slash commands run through Truss."],
  ["SETTINGS", "m opens settings outside chat; Tab changes fields; Theme previews forest, sage, and dusk."],
  ["APPROVALS", "Y or Enter allows; N or Escape denies."],
  ["CANCEL / EXIT", "Escape cancels an active agent run. Ctrl+C stops a process or run, and exits while idle."]
] as const;

if (process.argv.slice(2).some((argument) => argument === "--help" || argument === "-h")) {
  process.stdout.write(tuiHelp);
  process.exit(0);
}

function ensureInteractiveTerminal(): void {
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") return;

  // Git Bash exposes a pipe to Node for some console programs. winpty creates
  // the Windows console bridge Ink needs for keyboard input.
  if (process.platform === "win32" && process.env.MSYSTEM && process.env.TRUSS_TUI_WINPTY !== "1") {
    const result = spawnSync(
      "winpty",
      [process.execPath, fileURLToPath(import.meta.url), ...process.argv.slice(2)],
      {
        stdio: "inherit",
        env: { ...process.env, TRUSS_TUI_WINPTY: "1" }
      }
    );
    if (!result.error) process.exit(result.status ?? 1);
  }

  process.stderr.write(
    brand.productName + " TUI needs an interactive terminal with raw keyboard input. Open PowerShell or Windows Terminal and run " + brand.tuiCommand + ", or run winpty " + brand.tuiCommand + " from Git Bash.\n"
  );
  process.exit(1);
}

ensureInteractiveTerminal();

const execFile = promisify(execFileCallback);
const ignoredDirectories = new Set([".git", ".next", ".truss-harness", "node_modules", "dist", "coverage"]);
const focusOrder = ["files", "editor", "chat", "terminal"] as const;
type Focus = (typeof focusOrder)[number];
type Screen = "workspace" | "settings" | "approval" | "help" | "file-search";
type SettingsField = "server" | "endpoint" | "model" | "internet" | "theme";
type RunStatus = "ready" | "thinking" | "tool" | "waiting";
type ChatMessage = { readonly role: "user" | "assistant"; readonly content: string };
type ChatDisplayLine = { readonly role: ChatMessage["role"]; readonly text: string; readonly header: boolean };
type EditorDisplayRow = { readonly sourceLine: number; readonly continuation: boolean; readonly tokens: readonly SyntaxToken[] };

function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, Math.max(0, length - 3))}...`;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function visibleLines<T>(items: readonly T[], count: number, offset: number): readonly T[] {
  const end = Math.max(0, items.length - clamp(offset, 0, Math.max(0, items.length - count)));
  return items.slice(Math.max(0, end - count), end);
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

function plainChatText(value: string): string {
  let inCodeBlock = false;
  return value.split(/\r?\n/).flatMap((sourceLine) => {
    if (/^\s*```/.test(sourceLine)) {
      inCodeBlock = !inCodeBlock;
      return [];
    }
    if (inCodeBlock) return [`  ${sourceLine}`];
    const line = sourceLine
      .replace(/^\s{0,3}#{1,6}\s+/, "")
      .replace(/^\s*>\s?/, "")
      .replace(/^\s*[-*+]\s+/, "- ")
      .replace(/^\s*\d+[.)]\s+/, "- ")
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/(\*\*|__|\*|_|~~)/g, "");
    return /^\s*[-:|]+\s*$/.test(line) ? [] : [line];
  }).join("\n");
}

function chatDisplayLines(messages: readonly ChatMessage[], busy: boolean, width: number): readonly ChatDisplayLine[] {
  const transcript = messages.flatMap((message) => {
    const content = message.content
      ? message.role === "assistant" ? plainChatText(message.content) : message.content
      : busy && message.role === "assistant" ? "Thinking..." : "";
    return [
      { role: message.role, text: message.role === "user" ? "YOU" : "AGENT", header: true },
      ...wrapText(content, width).map((text) => ({ role: message.role, text, header: false }))
    ];
  });
  return transcript;
}

function configuredContextWindow(): number {
  const configured = Number.parseInt(process.env.TRUSS_HARNESS_CONTEXT_WINDOW ?? "8192", 10);
  return Number.isFinite(configured) ? Math.max(512, Math.min(1_000_000, configured)) : 8_192;
}

async function collectFiles(root: string, current = root, result: FileEntry[] = []): Promise<FileEntry[]> {
  if (result.length >= 2_000) return result;
  for (const entry of await readdir(current, { withFileTypes: true })) {
    if (result.length >= 2_000) break;
    if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) await collectFiles(root, join(current, entry.name), result);
    if (entry.isFile()) result.push({ path: relative(root, join(current, entry.name)) });
  }
  return result.sort((left, right) => left.path.localeCompare(right.path));
}

async function runTrackedCommand(command: string, workspaceRoot: string, onOutput: (output: string) => void, onProcess?: (process: ChildProcess | undefined) => void): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, { cwd: workspaceRoot, shell: true, windowsHide: true });
    onProcess?.(child);
    child.stdout.on("data", (data: Buffer) => onOutput(data.toString()));
    child.stderr.on("data", (data: Buffer) => onOutput(data.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      onProcess?.(undefined);
      onOutput(`\n[process exited: ${code ?? "unknown"}]\n`);
      resolve();
    });
  });
}

function detectedPreviewUrl(output: string): string | undefined {
  const match = output.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/[^\s]*)?/i);
  return match?.[0].replace(/[),.;]+$/, "").replace("0.0.0.0", "127.0.0.1");
}

function normalizedPreviewUrl(value: string): string {
  const normalized = /^[a-z][a-z\d+.-]*:\/\//i.test(value.trim()) ? value.trim() : `http://${value.trim()}`;
  const url = new URL(normalized);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Preview URLs must use HTTP or HTTPS.");
  return url.toString();
}

function openExternalPreview(value: string): void {
  const url = normalizedPreviewUrl(value);
  const [command, arguments_] = process.platform === "win32"
    ? ["rundll32.exe", ["url.dll,FileProtocolHandler", url]]
    : process.platform === "darwin"
      ? ["open", [url]]
      : ["xdg-open", [url]];
  const child = spawn(command, arguments_, { detached: true, stdio: "ignore", windowsHide: true });
  child.once("error", () => undefined);
  child.unref();
}

async function stopProcessTree(child: ChildProcess): Promise<void> {
  if (process.platform === "win32" && child.pid) {
    try {
      await execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
      return;
    } catch {
      // Fall back to the Node process handle if taskkill is unavailable.
    }
  }
  child.kill();
}

function Panel({ title, active, theme, children }: { readonly title: string; readonly active: boolean; readonly theme: TuiTheme; readonly children: React.ReactNode }): React.ReactElement {
  return <Box flexDirection="column" borderStyle="round" borderColor={active ? theme.focus : theme.panel} paddingX={1} width="100%" height="100%" overflow="hidden">
    <Text color={active ? theme.focus : theme.muted} bold>{title}</Text>
    {children}
  </Box>;
}

function App({ initialConfiguration }: { readonly initialConfiguration?: ResolvedConfiguration & { readonly tuiTheme?: TuiThemeName } }): React.ReactElement {
  const { exit } = useApp();
  const [viewport, setViewport] = useState(() => ({ columns: process.stdout.columns || 120, rows: process.stdout.rows || 36 }));
  const workspaceRoot = useMemo(() => cwd(), []);
  const [configuration, setConfiguration] = useState<ClientConfiguration | undefined>(initialConfiguration);
  const [client, setClient] = useState<Awaited<ReturnType<typeof createClientRuntime>> | undefined>();
  const [sessionId, setSessionId] = useState<string>();
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [fileIndex, setFileIndex] = useState(0);
  const [collapsedDirectories, setCollapsedDirectories] = useState<ReadonlySet<string>>(() => new Set());
  const [fileSearchInput, setFileSearchInput] = useState("");
  const [fileSearchIndex, setFileSearchIndex] = useState(0);
  const [openFilePath, setOpenFilePath] = useState<string>();
  const [editor, setEditor] = useState("Select a file from the workspace tree.");
  const [editorTitle, setEditorTitle] = useState("Preview");
  const [isDiff, setIsDiff] = useState(false);
  const [focus, setFocus] = useState<Focus>("chat");
  const [screen, setScreen] = useState<Screen>(initialConfiguration ? "workspace" : "settings");
  const [chatInput, setChatInput] = useState("");
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [chatScroll, setChatScroll] = useState(0);
  const [streamMetrics, setStreamMetrics] = useState({ startedAt: 0, generatedTokens: 0 });
  const [terminalLines, setTerminalLines] = useState<string[]>(["Terminal ready. Shell commands run in the workspace root; slash commands run locally."]);
  const [terminalScroll, setTerminalScroll] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [editorScroll, setEditorScroll] = useState(0);
  const [busy, setBusy] = useState(false);
  const [runStatus, setRunStatus] = useState<RunStatus>("ready");
  const [activePlan, setActivePlan] = useState<WorkspacePlan | undefined>();
  const [pendingTool, setPendingTool] = useState<ToolCall>();
  const [commandInput, setCommandInput] = useState("");
  const [endpoints, setEndpoints] = useState<readonly LocalModelEndpoint[]>([]);
  const [serverIndex, setServerIndex] = useState(0);
  const [models, setModels] = useState<readonly string[]>([]);
  const [modelIndex, setModelIndex] = useState(0);
  const [settingsField, setSettingsField] = useState<SettingsField>("server");
  const [themeName, setThemeName] = useState<TuiThemeName>(initialConfiguration?.tuiTheme ?? "forest");
  const [endpointInput, setEndpointInput] = useState(initialConfiguration?.baseUrl ?? "http://127.0.0.1:11434");
  const [modelInput, setModelInput] = useState(initialConfiguration?.model ?? "");
  const [providerKind, setProviderKind] = useState<LocalEndpointKind>(initialConfiguration?.provider ?? "ollama");
  const [agentMode] = useState(initialConfiguration?.mode ?? "chat");
  const [permissionMode] = useState(initialConfiguration?.permission ?? "ask");
  const [internetAccess, setInternetAccess] = useState(initialConfiguration?.internetAccess ?? false);
  const approvalResolvers = useRef(new Map<string, (approved: boolean) => void>());
  const abortController = useRef<AbortController | undefined>(undefined);
  const terminalProcess = useRef<ChildProcess | undefined>(undefined);
  const contextWindow = useMemo(configuredContextWindow, []);
  const contextTokens = useMemo(() => chat.reduce((total, message) => total + estimateTokens(message.content), 400), [chat]);
  const tokensPerSecond = streamMetrics.startedAt && streamMetrics.generatedTokens
    ? streamMetrics.generatedTokens / Math.max((Date.now() - streamMetrics.startedAt) / 1_000, 0.1)
    : undefined;
  const theme = tuiTheme(themeName);

  const appendTerminal = (output: string): void => {
    const next = output.replace(/\r/g, "").split("\n").filter(Boolean);
    if (!next.length) return;
    const detected = detectedPreviewUrl(output);
    if (detected) setPreviewUrl(detected);
    setTerminalScroll(0);
    setTerminalLines((current) => [...current, ...next].slice(-110));
  };
  const candidates = useMemo<readonly LocalModelEndpoint[]>(() => [
    ...endpoints,
    { id: "custom", label: "Custom compatible endpoint", kind: "openai-compatible", baseUrl: "" }
  ], [endpoints]);
  const selectedEndpoint = candidates[Math.min(serverIndex, Math.max(candidates.length - 1, 0))];
  const fileTree = useMemo(() => buildFileTree(files, collapsedDirectories), [files, collapsedDirectories]);
  const selectedFileTreeEntry = fileTree[Math.min(fileIndex, Math.max(0, fileTree.length - 1))];
  const fileSearchResults = useMemo(
    () => fuzzyFiles(files, fileSearchInput, Math.max(6, Math.min(14, viewport.rows - 10))),
    [files, fileSearchInput, viewport.rows]
  );
  const compactLayout = viewport.columns < 106;
  const terminalHeight = clamp(Math.floor(viewport.rows * 0.24), 7, 11);
  const workspaceHeight = Math.max(compactLayout ? 14 : 9, viewport.rows - terminalHeight - 6);
  const filesWidth = Math.max(20, Math.min(36, Math.floor(viewport.columns * 0.24)));
  const chatWidth = compactLayout ? Math.max(40, viewport.columns - 4) : Math.max(28, Math.min(48, Math.floor(viewport.columns * 0.31)));
  const editorWidth = compactLayout ? Math.max(30, viewport.columns - filesWidth - 4) : Math.max(30, viewport.columns - filesWidth - chatWidth - 4);
  const compactChatHeight = compactLayout ? clamp(Math.floor(workspaceHeight * 0.4), 6, 10) : workspaceHeight;
  const editorHeight = compactLayout ? Math.max(6, workspaceHeight - compactChatHeight - 1) : workspaceHeight;
  const editorLineCount = Math.max(2, editorHeight - 3);
  const chatLineCount = Math.max(2, compactChatHeight - (activePlan ? 7 : 0) - 4);
  const chatTranscript = chatDisplayLines(chat, busy, Math.max(12, chatWidth - 5));
  const chatLines = visibleLines(chatTranscript, chatLineCount, chatScroll);
  const editorRows = useMemo<readonly EditorDisplayRow[]>(() => {
    const maximumCharacters = Math.max(12, editorWidth - 7);
    return editor.split(/\r?\n/).flatMap((line, sourceIndex) => {
      const color: SyntaxToken["color"] = isDiff
        ? line.startsWith("+") && !line.startsWith("+++")
          ? "green"
          : line.startsWith("-") && !line.startsWith("---")
            ? "red"
            : undefined
        : undefined;
      const tokens: readonly SyntaxToken[] = isDiff ? [{ text: line, color }] : syntaxTokens(line, openFilePath ?? "");
      return wrapSyntaxTokens(tokens, maximumCharacters).map((row, rowIndex) => ({
        sourceLine: sourceIndex + 1,
        continuation: rowIndex > 0,
        tokens: row
      }));
    });
  }, [editor, editorWidth, isDiff, openFilePath]);
  const visibleEditorRows = editorRows.slice(editorScroll, editorScroll + editorLineCount);
  const visibleTerminalLines = visibleLines(terminalLines, Math.max(1, terminalHeight - 4), terminalScroll);
  const fileTreeStart = clamp(fileIndex - Math.floor(editorLineCount / 2), 0, Math.max(0, fileTree.length - editorLineCount));
  const visibleFileTree = fileTree.slice(fileTreeStart, fileTreeStart + editorLineCount);
  const overlayWidth = clamp(viewport.columns - 4, 42, 90);

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
    setFileIndex((current) => clamp(current, 0, Math.max(0, fileTree.length - 1)));
  }, [fileTree.length]);

  useEffect(() => {
    setEditorScroll((current) => clamp(current, 0, Math.max(0, editorRows.length - editorLineCount)));
  }, [editorRows.length, editorLineCount]);

  useEffect(() => {
    if (!openFilePath) return;
    const index = fileTree.findIndex((entry) => entry.kind === "file" && entry.path === openFilePath);
    if (index >= 0) setFileIndex(index);
  }, [fileTree, openFilePath]);

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
    const unsubscribe = client.events.subscribe((event) => {
      if (event.type === "text_delta") {
        setRunStatus("thinking");
        setChatScroll(0);
        setStreamMetrics((current) => current.startedAt
          ? { ...current, generatedTokens: current.generatedTokens + estimateTokens(event.text) }
          : current);
        setChat((current) => {
          const last = current.at(-1);
          if (!last || last.role !== "assistant") return [...current, { role: "assistant", content: event.text }];
          return [...current.slice(0, -1), { role: "assistant", content: last.content + event.text }];
        });
      }
      if (event.type === "tool_call_requested") {
        setRunStatus("tool");
        appendTerminal(`[tool requested] ${event.tool} ${JSON.stringify(event.input)}`);
      }
      if (event.type === "tool_completed") {
        setRunStatus("thinking");
        appendTerminal(`[tool completed] ${event.tool}: ${truncate(event.result.content, 160)}`);
      }
      if (event.type === "plan_updated") setActivePlan(event.plan);
      if (event.type === "run_failed") {
        setRunStatus("ready");
        appendTerminal(`[agent error] ${event.error.message}`);
      }
    });
    return () => {
      unsubscribe();
      void client.dispose();
    };
  }, [client]);

  const loadFile = async (entry: FileEntry): Promise<void> => {
    try {
      setIsDiff(false);
      setEditorScroll(0);
      setOpenFilePath(entry.path);
      setEditorTitle(entry.path);
      setEditor(await readFile(join(workspaceRoot, entry.path), "utf8"));
      setFocus("editor");
    } catch (error) {
      setEditor(`Unable to read ${entry.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const toggleDirectory = (path: string, expand?: boolean): void => {
    setCollapsedDirectories((current) => {
      const next = new Set(current);
      const currentlyExpanded = !next.has(path);
      const shouldExpand = expand ?? !currentlyExpanded;
      if (shouldExpand) next.delete(path);
      else next.add(path);
      return next;
    });
  };
  const openSearchResult = (entry: FileEntry): void => {
    const parts = entry.path.replaceAll("\\", "/").split("/");
    parts.pop();
    setCollapsedDirectories((current) => {
      const next = new Set(current);
      let path = "";
      for (const part of parts) {
        path = path ? `${path}/${part}` : part;
        next.delete(path);
      }
      return next;
    });
    setFileSearchInput("");
    setFileSearchIndex(0);
    setScreen("workspace");
    void loadFile(entry);
  };
  const toggleDiff = async (): Promise<void> => {
    if (!openFilePath) return;
    const entry = { path: openFilePath };
    if (isDiff) return void loadFile(entry);
    try {
      setOpenFilePath(entry.path);
      const { stdout } = await execFile("git", ["diff", "--no-ext-diff", "--", entry.path], { cwd: workspaceRoot, maxBuffer: 1_000_000 });
      setEditorTitle(`Diff: ${entry.path}`);
      setEditor(stdout || "No working-tree diff for this file.");
      setIsDiff(true);
      setEditorScroll(0);
    } catch (error) {
      setEditor(`Unable to load Git diff: ${error instanceof Error ? error.message : String(error)}`);
      setIsDiff(true);
    }
  };
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
      apiKey: process.env.TRUSS_HARNESS_API_KEY,
      systemPrompt: process.env.TRUSS_HARNESS_SYSTEM_PROMPT,
      mode: agentMode,
      internetAccess,
      approval: {
        approve: async (call) => {
          const readOnly = ["read_file", "list_directory", "search_files", "grep"].includes(call.name);
          if (permissionMode === "auto-all" || (permissionMode === "auto-read" && readOnly)) return true;
          return new Promise<boolean>((resolve) => {
          approvalResolvers.current.set(call.id, resolve);
          setPendingTool(call);
          setRunStatus("waiting");
          setScreen("approval");
          });
        }
      } satisfies ToolApproval
    };
    setConfiguration(nextConfiguration);
    setRunStatus("thinking");
    try {
      const nextClient = await createClientRuntime(nextConfiguration);
      setClient(nextClient);
      for (const server of nextClient.mcpServers) {
        appendTerminal(`[mcp] ${server.name}: ${server.state}${server.error ? ` (${server.error})` : ` (${server.toolCount} tools)`}`);
      }
    } catch (error) {
      appendTerminal(`[mcp] Unable to configure runtime: ${error instanceof Error ? error.message : String(error)}`);
      setRunStatus("ready");
      return;
    }
    setSessionId(undefined);
    setChat([]);
    setChatScroll(0);
    setStreamMetrics({ startedAt: 0, generatedTokens: 0 });
    setScreen("workspace");
    appendTerminal(`[configuration] ${nextConfiguration.provider} ${nextConfiguration.model} at ${nextConfiguration.baseUrl}`);
    setRunStatus("ready");
  };
  useEffect(() => {
    if (initialConfiguration && !client) void configureRuntime();
  }, []);
  const openFileContext = async (): Promise<readonly ContextBlock[]> => {
    if (!openFilePath) return [];
    try {
      // Keep the active file useful on small local context windows without crowding out the request and history.
      const maximumCharacters = Math.max(2_000, Math.min(20_000, contextWindow));
      const content = await readFile(join(workspaceRoot, openFilePath), "utf8");
      const clipped = content.slice(0, maximumCharacters);
      return [{
        source: `active-file:${openFilePath}`,
        content: `This is the currently open workspace file and the primary context for this request. Tool results produced later in the run take precedence over this request-start snapshot.\n\n${clipped}`,
        priority: 1_000
      }];
    } catch {
      return [];
    }
  };
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
    setChatScroll(0);
    setBusy(true);
    setRunStatus("thinking");
    setStreamMetrics({ startedAt: Date.now(), generatedTokens: 0 });
    setChat((current) => [...current, { role: "user", content: prompt }, { role: "assistant", content: "" }]);
    const controller = new AbortController();
    abortController.current = controller;
    try {
      const session = sessionId ? await client.runtime.getSession(sessionId) : await client.runtime.createSession();
      if (!session) throw new Error("Conversation is unavailable.");
      setSessionId(session.id);
      await client.runtime.run(session.id, prompt, controller.signal, await openFileContext());
    } catch (error) {
      if (!controller.signal.aborted) appendTerminal(`[agent error] ${error instanceof Error ? error.message : String(error)}`);
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
    setChatScroll(0);
    setStreamMetrics({ startedAt: 0, generatedTokens: 0 });
    appendTerminal("[conversation] Started a new conversation.");
  };
  const runTerminalInput = async (input: string): Promise<void> => {
    const command = await executeWorkspaceCommand({ workspaceRoot, input });
    if (command.handled) {
      appendTerminal(`[workspace command] ${command.command ?? input}: ${command.ok ? "completed" : "failed"}`);
      appendTerminal(command.message);
      return;
    }

    await runTrackedCommand(input, workspaceRoot, appendTerminal, (process) => { terminalProcess.current = process; });
  };
  const moveFocus = (direction: 1 | -1): void => {
    setFocus((current) => {
      const currentIndex = focusOrder.indexOf(current);
      return focusOrder[(currentIndex + direction + focusOrder.length) % focusOrder.length];
    });
  };

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      if (terminalProcess.current) {
        const process = terminalProcess.current;
        terminalProcess.current = undefined;
        void stopProcessTree(process).then(() => appendTerminal("[terminal] Process stopped."));
      } else if (busy) {
        abortController.current?.abort();
        setRunStatus("ready");
        appendTerminal("[agent] Cancellation requested.");
      }
      else exit();
      return;
    }
    if (screen === "approval") {
      if (input.toLowerCase() === "y" || key.return) resolveApproval(true);
      if (input.toLowerCase() === "n" || key.escape) resolveApproval(false);
      return;
    }
    if (screen === "file-search") {
      if (key.escape) {
        setFileSearchInput("");
        setFileSearchIndex(0);
        setScreen("workspace");
        return;
      }
      if (key.upArrow) {
        setFileSearchIndex((current) => Math.max(0, current - 1));
        return;
      }
      if (key.downArrow) {
        setFileSearchIndex((current) => Math.min(Math.max(0, fileSearchResults.length - 1), current + 1));
        return;
      }
      if (key.return) {
        const result = fileSearchResults[Math.min(fileSearchIndex, Math.max(0, fileSearchResults.length - 1))];
        if (result) openSearchResult(result);
        return;
      }
      if (key.backspace || key.delete) {
        setFileSearchInput((current) => current.slice(0, -1));
        setFileSearchIndex(0);
      } else if (input) {
        setFileSearchInput((current) => current + input);
        setFileSearchIndex(0);
      }
      return;
    }
    if (screen === "help") {
      setScreen("workspace");
      return;
    }
    if (screen === "settings") {
      if (key.escape) { setScreen("workspace"); return; }
      if (key.tab) {
        const fields: readonly SettingsField[] = ["server", "endpoint", "model", "internet", "theme"];
        setSettingsField((current) => {
          const index = fields.indexOf(current);
          return fields[(index + (key.shift ? -1 : 1) + fields.length) % fields.length];
        });
        return;
      }
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
      if (settingsField === "internet") {
        if (input === " " || key.leftArrow || key.rightArrow) setInternetAccess((current) => !current);
        if (key.return && endpointInput && modelInput) void configureRuntime();
        return;
      }
      if (settingsField === "theme") {
        if (key.leftArrow || key.upArrow) setThemeName((current) => tuiThemeNames[(tuiThemeNames.indexOf(current) - 1 + tuiThemeNames.length) % tuiThemeNames.length]);
        if (key.rightArrow || key.downArrow || input === " ") setThemeName((current) => tuiThemeNames[(tuiThemeNames.indexOf(current) + 1) % tuiThemeNames.length]);
        if (key.return && endpointInput && modelInput) void configureRuntime();
        return;
      }
      if (key.return && endpointInput && modelInput) { void configureRuntime(); return; }
      const setter = settingsField === "endpoint" ? setEndpointInput : setModelInput;
      if (key.backspace || key.delete) setter((current) => current.slice(0, -1));
      else if (!key.return && input) setter((current) => current + input);
      return;
    }
    if (key.ctrl && (key.leftArrow || key.rightArrow)) {
      moveFocus(key.leftArrow ? -1 : 1);
      return;
    }
    if (key.tab) {
      moveFocus(key.shift ? -1 : 1);
      return;
    }
    if (key.escape && busy) {
      abortController.current?.abort();
      setRunStatus("ready");
      appendTerminal("[agent] Cancellation requested.");
      return;
    }
    if (input === "o" && focus !== "chat" && focus !== "terminal" && previewUrl) {
      try {
        openExternalPreview(previewUrl);
        appendTerminal(`[preview] Opened ${previewUrl}`);
      } catch (error) {
        appendTerminal(`[preview error] ${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }
    if (focus === "terminal") {
      if (key.upArrow) { setTerminalScroll((current) => clamp(current + 1, 0, Math.max(0, terminalLines.length - Math.max(1, terminalHeight - 4)))); return; }
      if (key.downArrow) { setTerminalScroll((current) => clamp(current - 1, 0, Math.max(0, terminalLines.length - Math.max(1, terminalHeight - 4)))); return; }
      if (key.return) {
        const command = commandInput.trim();
        setCommandInput("");
        if (command) void runTerminalInput(command).catch((error: unknown) => appendTerminal(`[terminal error] ${String(error)}`));
        return;
      }
      if (key.backspace || key.delete) setCommandInput((current) => current.slice(0, -1));
      else if (input) setCommandInput((current) => current + input);
      return;
    }
    if (input === "?" && focus !== "chat") { setScreen("help"); return; }
    if (input === "m" && focus !== "chat") { setScreen("settings"); return; }
    if (input === "n" && focus !== "chat") { startNewConversation(); return; }
    if (focus === "files") {
      if (input === "/") {
        setFileSearchInput("");
        setFileSearchIndex(0);
        setScreen("file-search");
        return;
      }
      if (key.upArrow) setFileIndex((current) => Math.max(0, current - 1));
      if (key.downArrow) setFileIndex((current) => Math.min(Math.max(fileTree.length - 1, 0), current + 1));
      if (key.leftArrow && selectedFileTreeEntry?.kind === "directory") toggleDirectory(selectedFileTreeEntry.path, false);
      if (key.rightArrow && selectedFileTreeEntry?.kind === "directory") toggleDirectory(selectedFileTreeEntry.path, true);
      if (key.return && selectedFileTreeEntry?.kind === "directory") toggleDirectory(selectedFileTreeEntry.path);
      if (key.return && selectedFileTreeEntry?.kind === "file") void loadFile(selectedFileTreeEntry);
      return;
    }
    if (focus === "editor") {
      if (key.upArrow) { setEditorScroll((current) => clamp(current - 1, 0, Math.max(0, editorRows.length - editorLineCount))); return; }
      if (key.downArrow) { setEditorScroll((current) => clamp(current + 1, 0, Math.max(0, editorRows.length - editorLineCount))); return; }
      if (input === "d") void toggleDiff();
      return;
    }
    if (key.upArrow) {
      setChatScroll((current) => clamp(current + 1, 0, Math.max(0, chatTranscript.length - chatLineCount)));
      return;
    }
    if (key.downArrow) {
      setChatScroll((current) => clamp(current - 1, 0, Math.max(0, chatTranscript.length - chatLineCount)));
      return;
    }
    if (key.return) { void sendPrompt(); return; }
    if (key.backspace || key.delete) setChatInput((current) => current.slice(0, -1));
    else if (input) setChatInput((current) => current + input);
  });

  const filesPanel = <Panel title="FILES  [/] find" active={focus === "files"} theme={theme}>
    {visibleFileTree.map((entry, visibleIndex) => {
      const selected = fileTreeStart + visibleIndex === fileIndex;
      const marker = entry.kind === "directory" ? (entry.expanded ? "v " : "> ") : "  ";
      const indentation = " ".repeat(entry.depth * 2);
      const width = Math.max(6, filesWidth - indentation.length - 7);
      return <Text key={`${entry.kind}:${entry.path}`} wrap="truncate-end" color={selected ? theme.focus : entry.kind === "directory" ? theme.directory : entry.path === openFilePath ? theme.success : theme.text} bold={selected || entry.kind === "directory"}>
        {selected ? "> " : "  "}{indentation}{marker}{truncate(entry.name, width)}
      </Text>;
    })}
    {!fileTree.length && <Text color={theme.muted}>No workspace files found.</Text>}
  </Panel>;
  const editorPanel = <Panel title={`${editorTitle}  [up/down] scroll  [d] diff${previewUrl ? "  [o] browser" : ""}`} active={focus === "editor"} theme={theme}>
    {visibleEditorRows.map((row, index) => {
      const lineLabel = row.continuation ? "  |" : String(row.sourceLine).padStart(3);
      return <Text key={`${editorScroll + index}-${row.sourceLine}-${row.continuation}`} wrap="truncate-end" color={theme.text}><Text color={theme.muted}>{lineLabel}</Text> {row.tokens.map((token, tokenIndex) => <Text key={`${tokenIndex}-${token.text}`} color={token.color ? theme.syntax[token.color] : theme.text} dimColor={token.dim}>{token.text}</Text>)}</Text>;
    })}
  </Panel>;
  const agentPanel = <Panel title={chatScroll ? `AGENT  [${chatScroll} lines above]` : "AGENT  [Enter] send"} active={focus === "chat"} theme={theme}>
    {activePlan && <Box flexDirection="column" marginBottom={1}><Text bold color={theme.accent} wrap="truncate-end">PLAN: {truncate(activePlan.title, Math.max(8, chatWidth - 9))}</Text>{activePlan.steps.slice(0, 3).map((step) => <Text key={step.id} wrap="truncate-end" color={step.status === "completed" ? theme.success : step.status === "in_progress" ? theme.warning : theme.muted}>{step.status === "completed" ? "[x]" : step.status === "in_progress" ? "[..]" : "[ ]"} {truncate(step.content, Math.max(8, chatWidth - 7))}</Text>)}</Box>}
    {chatLines.map((line, index) => <Text key={`${line.role}-${line.header}-${index}-${line.text}`} color={line.role === "user" ? theme.user : theme.agent} bold={line.header}>{line.text}</Text>)}
    <Box flexGrow={1} />
    <Text wrap="truncate-end" color={focus === "chat" ? theme.focus : theme.muted}>{focus === "chat" ? "> " : "  "}{truncate(chatInput || (busy ? "Working... Escape cancels" : "Ask about this workspace"), Math.max(12, chatWidth - 5))}</Text>
  </Panel>;

  return <Box flexDirection="column" height={viewport.rows} paddingX={1} overflow="hidden">
    <Box height={1} justifyContent="space-between" marginBottom={1}>
      <Text bold color={theme.accent}>{brand.productName.toUpperCase()}</Text>
      <Text color={theme.muted}>{configuration ? `${configuration.provider} / ${configuration.model}` : "No model selected"}</Text>
      <Text color={runStatus === "waiting" ? theme.warning : busy ? theme.focus : theme.success}>{runStatus === "waiting" ? "APPROVAL" : runStatus === "tool" ? "TOOL" : busy ? "WORKING" : "READY"}</Text>
    </Box>
    <Box height={1} justifyContent="space-between" marginBottom={1}>
      <Text color={theme.muted}>CONTEXT <Text color={contextTokens / contextWindow >= 0.9 ? theme.error : contextTokens / contextWindow >= 0.7 ? theme.warning : theme.accent}>{formatTokenCount(contextTokens)} / {formatTokenCount(contextWindow)}</Text> estimated</Text>
      <Text color={theme.muted}>SPEED <Text color={busy ? theme.success : theme.muted}>{tokensPerSecond ? `${tokensPerSecond.toFixed(1)} tok/s` : "-- tok/s"}</Text>{previewUrl ? `  PREVIEW ${truncate(previewUrl, Math.max(16, Math.floor(viewport.columns * 0.3)))}` : ""}</Text>
    </Box>
    {compactLayout ? <Box height={workspaceHeight} flexDirection="column" gap={1} overflow="hidden">
      <Box height={editorHeight} flexDirection="row" gap={1} overflow="hidden">
        <Box width={filesWidth} height="100%">{filesPanel}</Box>
        <Box width={editorWidth} height="100%">{editorPanel}</Box>
      </Box>
      <Box height={compactChatHeight} width="100%">{agentPanel}</Box>
    </Box> : <Box height={workspaceHeight} flexDirection="row" gap={1} overflow="hidden">
      <Box width={filesWidth} height="100%">{filesPanel}</Box>
      <Box width={editorWidth} height="100%">{editorPanel}</Box>
      <Box width={chatWidth} height="100%">{agentPanel}</Box>
    </Box>}
    <Box height={terminalHeight} marginTop={1}><Panel title="TERMINAL  [Enter] run" active={focus === "terminal"} theme={theme}>
      {visibleTerminalLines.map((line, index) => <Text key={`${index}-${line}`} wrap="truncate-end" color={line.startsWith("[agent error]") || line.startsWith("[terminal error]") ? theme.error : line.startsWith("[tool") ? theme.warning : theme.muted}>{truncate(line, Math.max(20, viewport.columns - 8))}</Text>)}
      <Box flexGrow={1} />
      <Text wrap="truncate-end" color={focus === "terminal" ? theme.focus : theme.muted}>{focus === "terminal" ? "> " : "  "}{truncate(commandInput || "Type a workspace command", Math.max(16, viewport.columns - 10))}</Text>
    </Panel></Box>
    <Box height={1} marginTop={1} justifyContent="space-between"><Text color={theme.muted} wrap="truncate-end">Tab focus  |  Ctrl+Left/Right pane  |  / find  |  m settings  |  Esc cancel run  |  Ctrl+C exit idle</Text><Text color={theme.muted}>{sessionId ? `session ${sessionId.slice(0, 8)}` : "new session"}</Text></Box>
    {screen === "file-search" && <Box position="absolute" flexDirection="column" borderStyle="double" borderColor={theme.focus} paddingX={2} paddingY={1} width={overlayWidth} marginLeft={2} marginTop={3} backgroundColor={theme.overlay}>
      <Text bold color={theme.accent}>FIND FILE</Text>
      <Text color={theme.text}><Text color={theme.focus}>&gt; </Text>{fileSearchInput || <Text color={theme.muted}>Type part of a file name or path</Text>}</Text>
      <Text color={theme.muted}>Up/Down select  Enter open  Escape close</Text>
      <Box flexDirection="column" marginTop={1}>
        {fileSearchResults.map((entry, index) => {
          const selected = index === Math.min(fileSearchIndex, Math.max(0, fileSearchResults.length - 1));
          const fileName = entry.path.split("/").at(-1) ?? entry.path;
          return <Text key={entry.path} color={selected ? theme.focus : theme.text} bold={selected}>{selected ? "> " : "  "}{fileName}<Text color={theme.muted}>  {truncate(entry.path, Math.max(12, overlayWidth - fileName.length - 10))}</Text></Text>;
        })}
        {!fileSearchResults.length && <Text color={theme.warning}>No matching files.</Text>}
      </Box>
    </Box>}
    {screen === "settings" && <Box position="absolute" flexDirection="column" borderStyle="double" borderColor={theme.focus} paddingX={2} paddingY={1} width={overlayWidth} marginLeft={2} marginTop={3} backgroundColor={theme.overlay}>
      <Text bold color={theme.accent}>LOCAL MODEL CONFIGURATION</Text>
      <Text color={theme.muted}>Tab changes fields. Enter selects an item or saves when endpoint and model are set.</Text>
      <Text color={settingsField === "server" ? theme.focus : theme.text}>SERVER: {selectedEndpoint?.label ?? "Scanning local servers..."}</Text>
      <Text color={settingsField === "endpoint" ? theme.focus : theme.text}>ENDPOINT: {endpointInput}</Text>
      <Text color={settingsField === "model" ? theme.focus : theme.text}>MODEL: {modelInput || models[modelIndex] || "Choose or type a model"}</Text>
      <Text color={settingsField === "internet" ? theme.focus : theme.text}>INTERNET RESEARCH: {internetAccess ? "enabled" : "disabled"} {settingsField === "internet" ? "[Space toggles]" : ""}</Text>
      <Text color={settingsField === "theme" ? theme.focus : theme.text}>THEME: {themeName} {settingsField === "theme" ? "[Left/Right changes]" : ""}</Text>
      <Text color={theme.muted}>Detected models: {models.slice(0, 5).join(", ") || "none; type one manually"}</Text>
      <Text color={theme.warning}>Provider: {providerKind}. Use the server selector for Ollama or compatible endpoints.</Text>
    </Box>}
    {screen === "approval" && <Box position="absolute" flexDirection="column" borderStyle="double" borderColor={theme.warning} paddingX={2} paddingY={1} width={overlayWidth} marginLeft={2} marginTop={8} backgroundColor={theme.overlay}>
      <Text bold color={theme.warning}>TOOL APPROVAL REQUIRED</Text>
      <Text color={theme.text}>{pendingTool?.name} {JSON.stringify(pendingTool?.input)}</Text>
      <Text color={theme.muted}>Press Y or Enter to allow. Press N or Escape to deny.</Text>
    </Box>}
    {screen === "help" && <Box position="absolute" flexDirection="column" borderStyle="double" borderColor={theme.focus} paddingX={2} paddingY={1} width={overlayWidth} marginLeft={2} marginTop={7} backgroundColor={theme.overlay}>
      <Text bold color={theme.accent}>TUI CONTROLS</Text>
      {tuiControlHelp.map(([label, detail]) => <Text key={label} color={theme.text} wrap="wrap"><Text bold color={theme.focus}>{label}: </Text>{detail}</Text>)}
      <Box marginTop={1}><Text bold color={theme.accent}>WORKSPACE COMMANDS</Text></Box>
      {workspaceCommandHelp().split("\n").slice(1).map((line) => <Text key={line} color={theme.text}>{line}</Text>)}
      <Text color={theme.muted}>Press any key to close this reference.</Text>
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
