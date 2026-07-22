import { app, BrowserWindow, dialog, ipcMain, protocol, safeStorage, shell, type OpenDialogOptions } from "electron";
import { autoUpdater } from "electron-updater";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { brand } from "@truss-harness/branding";
import { createClientRuntime, type ClientConfiguration } from "@truss-harness/cli/runtime";
import { createPairingUri, detectLanAddress, startRemoteGateway, type RunningRemoteGateway } from "@truss-harness/gateway";
import { parseMcpServerConfigurations } from "@truss-harness/mcp";
import { cloudProviderDefinition, detectActiveLocalModel, detectLocalContextWindow, detectLocalEndpoints, generateLocalText, isCloudProviderId, isLocalEndpointKind, listLocalModels, type LocalModelEndpoint } from "@truss-harness/provider-openai-compatible";
import { executeWorkspaceCommand, FileWorkspacePlanStore, type ChatAttachment, type ContextBlock, type RemoteToolApprovalMode, type ToolApproval, type ToolCall } from "@truss-harness/runtime";
import { desktopThemeNames, type DesktopConfiguration, type DesktopConversation, type DesktopEndpoint, type DesktopEvent, type DesktopFile, type DesktopGitStatus, type DesktopMessage, type DesktopState, type DesktopProvider, type DesktopThemePalette, type DesktopThemePreference, type DesktopWorkspaceUiState } from "./shared.js";
import QRCode from "qrcode";

const execFile = promisify(execFileCallback);
const ignoredDirectories = new Set([".git", "node_modules", "dist", "coverage", ".next"]);
const mediaTypes = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  [".mp4", "video/mp4"],
  [".webm", "video/webm"]
]);

protocol.registerSchemesAsPrivileged([{
  scheme: "truss-media",
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
}]);

interface PersistedState extends DesktopState {}

let mainWindow: BrowserWindow | undefined;
const defaultTheme: DesktopThemePreference = { name: "default" };
let persisted: PersistedState = { workspaceRoot: process.cwd(), updates: { checkOnLaunch: true, autoDownload: false }, theme: defaultTheme, conversations: [] };
let runtimeClient: Awaited<ReturnType<typeof createClientRuntime>> | undefined;
let unsubscribeEvents: (() => void) | undefined;
let activeSessionId: string | undefined;
let activeConversationId: string | undefined;
let activeAbort: AbortController | undefined;
let activeRun: Promise<void> | undefined;
let devServerProcess: ReturnType<typeof spawn> | undefined;
let trussGoGateway: RunningRemoteGateway | undefined;
const trussGoClients: Array<Awaited<ReturnType<typeof createClientRuntime>>> = [];
let updaterConfigured = false;
const approvalResolvers = new Map<string, (approved: boolean) => void>();
const sessionConversationIds = new Map<string, string>();

function send(event: DesktopEvent): void {
  mainWindow?.webContents.send("truss:event", event);
}

function updaterError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  send({ type: "update", status: "error", message });
}

function updaterSupported(): boolean {
  return app.isPackaged && (process.platform === "win32" || (process.platform === "linux" && process.arch === "x64" && Boolean(process.env.APPIMAGE)));
}

function configureUpdater(): void {
  if (!updaterSupported() || updaterConfigured) return;
  updaterConfigured = true;
  autoUpdater.autoDownload = persisted.updates.autoDownload;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on("checking-for-update", () => send({ type: "update", status: "checking" }));
  autoUpdater.on("update-available", (info) => send({ type: "update", status: "available", version: info.version }));
  autoUpdater.on("update-not-available", (info) => send({ type: "update", status: "not-available", version: info.version }));
  autoUpdater.on("download-progress", (progress) => send({ type: "update", status: "downloading", percent: progress.percent }));
  autoUpdater.on("update-downloaded", (info) => send({ type: "update", status: "downloaded", version: info.version }));
  autoUpdater.on("error", updaterError);
  if (persisted.updates.checkOnLaunch) {
    setTimeout(() => { void autoUpdater.checkForUpdates().catch(updaterError); }, 1_500);
  }
}

function detectedPreviewUrl(output: string): string | undefined {
  const match = output.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/[^\s]*)?/i);
  return match?.[0].replace(/[),.;]+$/, "").replace("0.0.0.0", "127.0.0.1");
}

function validatedPreviewUrl(value: string): string {
  const normalized = /^[a-z][a-z\d+.-]*:\/\//i.test(value.trim()) ? value.trim() : `http://${value.trim()}`;
  const url = new URL(normalized);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Preview URLs must use HTTP or HTTPS.");
  return url.toString();
}

function isAllowedPreviewUrl(value: string): boolean {
  if (value === "about:blank") return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function stopManagedDevServer(): void {
  const child = devServerProcess;
  devServerProcess = undefined;
  if (!child || child.killed) return;
  if (process.platform === "win32" && child.pid) {
    void execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"]).catch(() => child.kill());
  } else {
    child.kill();
  }
  send({ type: "dev-server", status: "stopped" });
}

function distDirectory(): string {
  return join(app.getAppPath(), "dist");
}

function statePath(): string {
  return join(app.getPath("userData"), "desktop-state.json");
}

function credentialPath(): string {
  return join(app.getPath("userData"), "credentials.json");
}

async function readCredentials(): Promise<Readonly<Record<string, string>>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(credentialPath(), "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === "string")) as Readonly<Record<string, string>>;
  } catch {
    return {};
  }
}

function ensureSecureStorage(): void {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure credential storage is unavailable on this system.");
}

async function storedCredential(provider: DesktopProvider): Promise<string | undefined> {
  if (!isCloudProviderId(provider)) return undefined;
  ensureSecureStorage();
  const encoded = (await readCredentials())[provider];
  if (!encoded) return undefined;
  try {
    return safeStorage.decryptString(Buffer.from(encoded, "base64"));
  } catch {
    throw new Error(`The stored ${cloudProviderDefinition(provider).label} credential could not be decrypted. Remove it and configure the provider again.`);
  }
}

async function saveCredential(provider: DesktopProvider, value: string): Promise<void> {
  if (!isCloudProviderId(provider)) return;
  ensureSecureStorage();
  const credentials = await readCredentials();
  await writeFile(credentialPath(), `${JSON.stringify({ ...credentials, [provider]: safeStorage.encryptString(value).toString("base64") }, null, 2)}\n`, "utf8");
}

async function removeCredential(provider: DesktopProvider): Promise<void> {
  if (!isCloudProviderId(provider)) return;
  const credentials = await readCredentials();
  const { [provider]: _removed, ...remaining } = credentials;
  await writeFile(credentialPath(), `${JSON.stringify(remaining, null, 2)}\n`, "utf8");
}

async function loadPersistedState(): Promise<void> {
  try {
    const parsed = JSON.parse(await readFile(statePath(), "utf8")) as Partial<PersistedState>;
    persisted = {
      workspaceRoot: typeof parsed.workspaceRoot === "string" ? parsed.workspaceRoot : process.cwd(),
      configuration: isConfiguration(parsed.configuration) ? normalizeConfiguration(parsed.configuration) : undefined,
      updates: parsed.updates && typeof parsed.updates === "object"
        ? { checkOnLaunch: (parsed.updates as { checkOnLaunch?: unknown }).checkOnLaunch !== false, autoDownload: (parsed.updates as { autoDownload?: unknown }).autoDownload === true }
        : { checkOnLaunch: true, autoDownload: false },
      theme: isThemePreference(parsed.theme) ? parsed.theme : defaultTheme,
      conversations: Array.isArray(parsed.conversations) ? parsed.conversations.slice(0, 30) : [],
      activeConversationId: typeof parsed.activeConversationId === "string" ? parsed.activeConversationId : undefined,
      workspaceUiState: normalizeWorkspaceUiState(parsed.workspaceUiState)
    };
  } catch {
    persisted = { workspaceRoot: process.cwd(), updates: { checkOnLaunch: true, autoDownload: false }, theme: defaultTheme, conversations: [] };
  }
}

async function persistState(): Promise<void> {
  await writeFile(statePath(), `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
}

function isConfiguration(value: unknown): value is DesktopConfiguration {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DesktopConfiguration>;
  return (isLocalEndpointKind(candidate.provider) || isCloudProviderId(candidate.provider))
    && typeof candidate.baseUrl === "string"
    && typeof candidate.model === "string"
    && (candidate.mode === "chat" || candidate.mode === "plan" || candidate.mode === "edit")
    && (candidate.permission === "ask" || candidate.permission === "auto-read" || candidate.permission === "auto-all")
    && typeof candidate.contextWindow === "number"
    && (candidate.internetAccess === undefined || typeof candidate.internetAccess === "boolean");
}

function normalizeConfiguration(value: DesktopConfiguration): DesktopConfiguration {
  return {
    ...value,
    baseUrl: isCloudProviderId(value.provider) ? cloudProviderDefinition(value.provider).baseUrl : value.baseUrl.trim(),
    model: value.model.trim(),
    contextWindow: Math.max(512, Math.min(1_000_000, Math.floor(value.contextWindow || 8_192))),
    internetAccess: value.internetAccess ?? false,
    mcpServers: parseMcpServerConfigurations(value.mcpServers)
  };
}

function isLocalConfiguration(configuration: DesktopConfiguration): configuration is DesktopConfiguration & { readonly provider: "ollama" | "openai-compatible" } {
  return isLocalEndpointKind(configuration.provider);
}

function normalizeWorkspaceUiState(value: unknown): DesktopWorkspaceUiState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<DesktopWorkspaceUiState>;
  const expandedDirectories = Array.isArray(candidate.expandedDirectories)
    ? candidate.expandedDirectories.filter((path): path is string => typeof path === "string")
    : [];
  const openEditors = Array.isArray(candidate.openEditors)
    ? candidate.openEditors.flatMap((editor) => editor && typeof editor === "object"
      && typeof editor.path === "string" && (editor.mode === "file" || editor.mode === "diff")
      ? [{ path: editor.path, mode: editor.mode, scrollTop: typeof editor.scrollTop === "number" && Number.isFinite(editor.scrollTop) ? Math.max(0, editor.scrollTop) : 0 }]
      : [])
    : [];
  return {
    expandedDirectories,
    openEditors,
    activeFile: typeof candidate.activeFile === "string" ? candidate.activeFile : undefined,
    fileTreeScrollTop: typeof candidate.fileTreeScrollTop === "number" && Number.isFinite(candidate.fileTreeScrollTop) ? Math.max(0, candidate.fileTreeScrollTop) : 0
  };
}

function isColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function isThemePalette(value: unknown): value is DesktopThemePalette {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every(isColor);
}

function isThemePreference(value: unknown): value is DesktopThemePreference {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DesktopThemePreference>;
  return typeof candidate.name === "string"
    && desktopThemeNames.includes(candidate.name as DesktopThemePreference["name"])
    && (candidate.custom === undefined || isThemePalette(candidate.custom));
}

function localEndpoint(configuration: Pick<DesktopConfiguration, "baseUrl"> & { readonly provider: "ollama" | "openai-compatible" }): LocalModelEndpoint {
  return { id: "configured", label: "Configured endpoint", kind: configuration.provider, baseUrl: configuration.baseUrl };
}

async function clientConfiguration(configuration: DesktopConfiguration): Promise<ClientConfiguration> {
  const approval: ToolApproval = {
    approve(call: ToolCall): Promise<boolean> {
      const readOnly = ["read_file", "list_directory", "search_files", "grep"].includes(call.name);
      if (configuration.permission === "auto-all" || (configuration.permission === "auto-read" && readOnly)) return Promise.resolve(true);
      return new Promise<boolean>((resolveApproval) => {
        approvalResolvers.set(call.id, resolveApproval);
        send({ type: "approval", callId: call.id, tool: call.name, input: call.input });
      });
    }
  };
  return {
    workspaceRoot: persisted.workspaceRoot,
    provider: configuration.provider as ClientConfiguration["provider"],
    baseUrl: configuration.baseUrl,
    model: configuration.model,
    apiKey: await storedCredential(configuration.provider),
    mode: configuration.mode,
    internetAccess: configuration.internetAccess,
    mcpServers: configuration.mcpServers,
    approval
  };
}

function mobileApproval(mode: RemoteToolApprovalMode = "ask"): ToolApproval & { resolve(callId: string, approved: boolean): boolean; denyAll(): void } {
  const pending = new Map<string, (approved: boolean) => void>();
  return {
    approve(call: ToolCall): Promise<boolean> {
      if (mode === "auto-all") return Promise.resolve(true);
      if (mode === "auto-read" && ["read_file", "list_directory", "search_files", "grep"].includes(call.name)) return Promise.resolve(true);
      return new Promise((resolveApproval) => pending.set(call.id, resolveApproval));
    },
    resolve(callId: string, approved: boolean): boolean { const resolveApproval = pending.get(callId); if (!resolveApproval) return false; pending.delete(callId); resolveApproval(approved); return true; },
    denyAll(): void { for (const resolveApproval of pending.values()) resolveApproval(false); pending.clear(); }
  };
}

async function stopTrussGo(): Promise<void> {
  await trussGoGateway?.close(); trussGoGateway = undefined;
  await Promise.all(trussGoClients.splice(0).map((client) => client.dispose()));
}

async function connectTrussGo(): Promise<{ readonly workspaceName: string; readonly qrDataUrl: string }> {
  const configuration = persisted.configuration;
  if (!configuration?.model) throw new Error("Choose a local model before connecting Truss Go.");
  const address = detectLanAddress();
  if (!address) throw new Error("Could not find a private Wi-Fi address for this computer.");
  await stopTrussGo();
  const token = randomBytes(32).toString("hex");
  trussGoGateway = await startRemoteGateway({
    token, host: address, port: 0,
    workspaces: [{ id: "active-workspace", displayName: basename(persisted.workspaceRoot), createRuntime: async (mode, toolApprovalMode) => {
      const approval = mobileApproval(toolApprovalMode);
      const client = await createClientRuntime({ ...(await clientConfiguration(configuration)), mode, approval });
      trussGoClients.push(client);
      return { runtime: client.runtime, events: client.events, approval, dispose: client.dispose };
    } }]
  });
  const pairingUri = createPairingUri({ gatewayUrl: trussGoGateway.url, token, workspaceName: basename(persisted.workspaceRoot) });
  return { workspaceName: basename(persisted.workspaceRoot), qrDataUrl: await QRCode.toDataURL(pairingUri, { margin: 2, width: 320 }) };
}

async function releaseOllamaModel(configuration: DesktopConfiguration | undefined): Promise<void> {
  if (!configuration || configuration.provider !== "ollama" || !configuration.model) return;
  try {
    await fetch(`${configuration.baseUrl.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: configuration.model, keep_alive: 0 }),
      signal: AbortSignal.timeout(2_000)
    });
  } catch {
    // Local server lifecycle is provider-owned; release is best-effort.
  }
}

async function disposeRuntime(): Promise<void> {
  activeAbort?.abort();
  activeAbort = undefined;
  activeRun = undefined;
  activeSessionId = undefined;
  activeConversationId = undefined;
  sessionConversationIds.clear();
  unsubscribeEvents?.();
  unsubscribeEvents = undefined;
  const previousClient = runtimeClient;
  runtimeClient = undefined;
  await previousClient?.dispose();
  for (const resolveApproval of approvalResolvers.values()) resolveApproval(false);
  approvalResolvers.clear();
}

async function configureRuntime(configuration: DesktopConfiguration): Promise<void> {
  await disposeRuntime();
  runtimeClient = await createClientRuntime(await clientConfiguration(configuration));
  persisted = { ...persisted, mcpStatuses: runtimeClient.mcpServers };
  unsubscribeEvents = runtimeClient.events.subscribe((event) => send({ type: "agent", conversationId: sessionConversationIds.get(event.sessionId), event }));
}

function ensurePathInsideWorkspace(path: string): string {
  const workspace = resolve(persisted.workspaceRoot);
  const target = resolve(workspace, path);
  if (target !== workspace && !target.startsWith(`${workspace}${sep}`)) throw new Error("Path must remain inside the selected workspace.");
  return target;
}

function mediaType(path: string): string | undefined {
  const extension = path.slice(path.lastIndexOf(".")).toLowerCase();
  return mediaTypes.get(extension);
}

async function workspaceMediaResponse(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (url.hostname !== "workspace") return new Response("Unknown media source.", { status: 404 });
    const relativePath = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    const target = ensurePathInsideWorkspace(relativePath);
    const contentType = mediaType(target);
    if (!contentType) return new Response("Unsupported media type.", { status: 415 });
    const file = await stat(target);
    if (!file.isFile()) return new Response("Media file not found.", { status: 404 });

    let start = 0;
    let end = Math.max(0, file.size - 1);
    let status = 200;
    const range = request.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
    if (range && file.size > 0) {
      if (!range[1] && range[2]) {
        const suffixLength = Math.min(file.size, Number.parseInt(range[2], 10));
        start = file.size - suffixLength;
      } else {
        start = Number.parseInt(range[1] || "0", 10);
        end = range[2] ? Math.min(file.size - 1, Number.parseInt(range[2], 10)) : file.size - 1;
      }
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= file.size) {
        return new Response(null, { status: 416, headers: { "content-range": `bytes */${file.size}` } });
      }
      status = 206;
    }

    const length = file.size ? end - start + 1 : 0;
    const headers: Record<string, string> = {
      "accept-ranges": "bytes",
      "cache-control": "no-store",
      "content-length": String(length),
      "content-type": contentType
    };
    if (status === 206) headers["content-range"] = `bytes ${start}-${end}/${file.size}`;
    if (request.method === "HEAD" || file.size === 0) return new Response(null, { status, headers });
    const body = Readable.toWeb(createReadStream(target, { start, end })) as ReadableStream<Uint8Array>;
    return new Response(body, { status, headers });
  } catch {
    return new Response("Media file not found.", { status: 404 });
  }
}

async function collectFiles(): Promise<DesktopFile[]> {
  const files: DesktopFile[] = [];
  const visit = async (current: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const entryPath = join(current, entry.name);
      const workspacePath = relative(persisted.workspaceRoot, entryPath);
      if (entry.isDirectory()) {
        files.push({ path: workspacePath, type: "directory" });
        if (!ignoredDirectories.has(entry.name)) await visit(entryPath);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        files.push({ path: workspacePath, type: "file" });
      }
    }
  };
  await visit(persisted.workspaceRoot);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

async function listDirectory(path: string): Promise<DesktopFile[]> {
  const directory = ensurePathInsideWorkspace(path);
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() || entry.isFile() || entry.isSymbolicLink())
    .map((entry) => ({
      path: relative(persisted.workspaceRoot, join(directory, entry.name)),
      type: entry.isDirectory() ? "directory" as const : "file" as const
    }))
    .sort((left, right) => left.type === right.type ? left.path.localeCompare(right.path) : left.type === "directory" ? -1 : 1);
}

async function gitOutput(args: readonly string[]): Promise<string> {
  try {
    return (await execFile("git", [...args], { cwd: persisted.workspaceRoot, maxBuffer: 1_000_000 })).stdout;
  } catch (error) {
    const stdout = error && typeof error === "object" && "stdout" in error ? (error as { readonly stdout?: unknown }).stdout : undefined;
    return typeof stdout === "string" ? stdout : "";
  }
}

function normalizeCommitMessage(value: string): string {
  return value.trim()
    .replace(/^```(?:gitcommit|text|markdown)?\s*/i, "")
    .replace(/\s*```$/, "")
    .replace(/^(?:commit message|message):\s*/i, "")
    .trim();
}

function compactCommitDiff(diff: string, contextWindow: number): string {
  const limit = Math.max(8_000, Math.min(48_000, Math.floor(contextWindow * 1.25)));
  if (diff.length <= limit) return diff;

  const segments = diff.split(/(?=^diff --git )/m).filter(Boolean);
  const isGenerated = (segment: string): boolean => /(?:package-lock\.json|(?:^|[/\\])(?:dist|coverage|\.next)(?:[/\\])|\.map(?:\r?$))/m.test(segment);
  const selected: string[] = [];
  let remaining = limit - 240;
  for (const segment of [...segments.filter((segment) => !isGenerated(segment)), ...segments.filter(isGenerated)]) {
    if (remaining <= 0) break;
    if (segment.length <= remaining) {
      selected.push(segment);
      remaining -= segment.length;
      continue;
    }
    const head = Math.max(1_000, Math.floor(remaining * 0.7));
    const tail = Math.max(500, remaining - head - 90);
    selected.push(`${segment.slice(0, head)}\n... diff content omitted for context budget ...\n${segment.slice(-tail)}`);
    remaining = 0;
  }
  if (!selected.length) selected.push(`${diff.slice(0, Math.floor(limit * 0.7))}\n... diff content omitted for context budget ...\n${diff.slice(-Math.floor(limit * 0.25))}`);
  return `The full diff exceeds the configured context budget. Generate a message from this representative selection; do not mention that it was truncated.\n\n${selected.join("\n")}`;
}

async function generateCommitMessage(): Promise<string> {
  const configuration = persisted.configuration;
  if (!configuration?.model) throw new Error("Choose a local model before generating a commit message.");
  if (!isLocalConfiguration(configuration)) throw new Error("Commit-message generation for cloud providers will use the shared agent runtime in the next Desktop slice.");

  let diff = await gitOutput(["diff", "--cached", "--no-ext-diff"]);
  if (!diff.trim()) diff = await gitOutput(["diff", "--no-ext-diff"]);
  if (!diff.trim()) throw new Error("There are no staged or unstaged changes to summarize.");

  const prompt = `You write accurate, production-quality Git commit messages. Analyze the diff and return only one Conventional Commit message.

Requirements:
- First line format: type(optional scope): imperative summary
- Choose the most accurate type from feat, fix, refactor, perf, docs, test, build, ci, or chore.
- Keep the subject under 72 characters and describe the actual user-visible or technical change.
- Use specific verbs and nouns. Do not use vague wording such as "update", "changes", or "stuff".
- Add a blank line and a concise body only when it clarifies important behavior, constraints, or follow-up effects.
- Do not include Markdown, quotes, explanations, issue numbers, or text such as "Commit message:".

Diff:
${compactCommitDiff(diff, configuration.contextWindow)}`;
  const response = await generateLocalText({ kind: configuration.provider, baseUrl: configuration.baseUrl, model: configuration.model }, prompt);
  const message = normalizeCommitMessage(response);
  if (!message) throw new Error("The model returned an empty commit message.");
  return message;
}

async function gitCommand(args: readonly string[]): Promise<string> {
  try {
    const { stdout, stderr } = await execFile("git", [...args], { cwd: persisted.workspaceRoot, maxBuffer: 1_000_000 });
    return (stdout || stderr || "Git command completed.").trim();
  } catch (error) {
    const detail = error && typeof error === "object"
      ? ["stderr", "stdout"].map((key) => (error as Record<string, unknown>)[key]).find((value): value is string => typeof value === "string" && Boolean(value.trim()))
      : undefined;
    throw new Error(detail?.trim() || (error instanceof Error ? error.message : String(error)));
  }
}

async function gitPathExistsAtHead(path: string): Promise<boolean> {
  try {
    await execFile("git", ["cat-file", "-e", `HEAD:${path}`], { cwd: persisted.workspaceRoot, maxBuffer: 1_000_000 });
    return true;
  } catch {
    return false;
  }
}

function gitPaths(paths: readonly string[]): string[] {
  if (!Array.isArray(paths) || !paths.length) throw new Error("Select at least one file.");
  return paths.map((path) => relative(persisted.workspaceRoot, ensurePathInsideWorkspace(path)));
}

async function getGitStatus(): Promise<DesktopGitStatus> {
  try {
    const output = await gitCommand(["status", "--porcelain=v1", "--branch"]);
    let branch: string | undefined;
    let ahead = 0;
    let behind = 0;
    const files: DesktopGitStatus["files"][number][] = [];
    for (const line of output.split(/\r?\n/)) {
      if (line.startsWith("## ")) {
        const details = line.slice(3);
        branch = details.split("...")[0].trim();
        const aheadBehind = details.match(/\[ahead (\d+)(?:, behind (\d+))?\]|\[behind (\d+)(?:, ahead (\d+))?\]/);
        if (aheadBehind) {
          ahead = Number.parseInt(aheadBehind[1] ?? aheadBehind[4] ?? "0", 10);
          behind = Number.parseInt(aheadBehind[2] ?? aheadBehind[3] ?? "0", 10);
        }
        continue;
      }
      if (line.length < 4) continue;
      files.push({ path: line.slice(3), indexStatus: line[0], workTreeStatus: line[1] });
    }
    return { available: true, branch, ahead, behind, files };
  } catch (error) {
    return { available: false, ahead: 0, behind: 0, files: [], error: error instanceof Error ? error.message : String(error) };
  }
}

async function fileContext(activeFilePath: string | undefined, attachedPaths: readonly string[] | undefined, openFilePaths: readonly string[] | undefined): Promise<readonly ContextBlock[]> {
  const attached = new Set(attachedPaths ?? []);
  const openFiles = new Set(openFilePaths ?? []);
  const paths = [...new Set([activeFilePath, ...(attachedPaths ?? []), ...(openFilePaths ?? [])].filter((path): path is string => Boolean(path)))].slice(0, 8);
  const blocks: ContextBlock[] = [];
  const primaryBudget = Math.max(2_000, Math.min(20_000, persisted.configuration?.contextWindow ?? 8_192));
  let remaining = 80_000;
  for (const path of paths) {
    if (remaining <= 0) break;
    try {
      const isPrimary = path === activeFilePath;
      const isAttached = attached.has(path);
      const source = isPrimary ? "active-file" : isAttached ? "attached-file" : "open-file";
      const priority = isPrimary ? 1_000 : isAttached ? 400 : 100;
      const contentType = mediaType(path);
      if (contentType && contentType !== "image/svg+xml") {
        blocks.push({
          source: `${source}:${path}`,
          content: `This ${contentType.startsWith("video/") ? "video" : "image"} file is open in the desktop viewer. Binary content is not included in text model context.`,
          priority
        });
        continue;
      }
      const content = await readFile(ensurePathInsideWorkspace(path), "utf8");
      const clipped = content.slice(0, Math.min(isPrimary ? primaryBudget : 30_000, remaining));
      blocks.push({
        source: `${source}:${path}`,
        content: isPrimary
          ? `This is the currently open workspace file and the primary context for this request. Tool results produced later in the run take precedence over this request-start snapshot.\n\n${clipped}`
          : !isAttached && openFiles.has(path)
            ? `This workspace file is currently open in another editor tab.\n\n${clipped}`
            : clipped,
        priority
      });
      remaining -= clipped.length;
    } catch {
      // The renderer only offers workspace files, but a stale entry must not fail a chat request.
    }
  }
  return blocks;
}

async function executeChat(input: { readonly prompt: string; readonly conversationId: string; readonly history: readonly DesktopMessage[]; readonly attachments?: readonly ChatAttachment[]; readonly activeFilePath?: string; readonly attachedPaths?: readonly string[]; readonly openFilePaths?: readonly string[] }): Promise<void> {
  const configuration = persisted.configuration;
  if (!configuration || !configuration.model) throw new Error("Choose a local model before starting the agent.");
  if (!runtimeClient) await configureRuntime(configuration);
  const client = runtimeClient as Awaited<ReturnType<typeof createClientRuntime>>;
  if (!activeSessionId || activeConversationId !== input.conversationId) {
    const session = await client.runtime.createSession(input.history);
    activeSessionId = session.id;
    activeConversationId = input.conversationId;
    sessionConversationIds.set(session.id, input.conversationId);
  }
  const controller = new AbortController();
  activeAbort = controller;
  send({ type: "chat-start", conversationId: input.conversationId });
  try {
    await client.runtime.run(activeSessionId, input.prompt, controller.signal, await fileContext(input.activeFilePath, input.attachedPaths, input.openFilePaths), input.attachments);
    send({ type: "chat-end", conversationId: input.conversationId, aborted: controller.signal.aborted });
  } catch (error) {
    if (!controller.signal.aborted) send({ type: "chat-error", conversationId: input.conversationId, message: error instanceof Error ? error.message : String(error) });
    else send({ type: "chat-end", conversationId: input.conversationId, aborted: true });
  } finally {
    if (activeAbort === controller) activeAbort = undefined;
  }
}

async function runChat(input: { readonly prompt: string; readonly conversationId: string; readonly history: readonly DesktopMessage[]; readonly attachments?: readonly ChatAttachment[]; readonly activeFilePath?: string; readonly attachedPaths?: readonly string[]; readonly openFilePaths?: readonly string[] }): Promise<void> {
  const previousRun = activeRun;
  if (previousRun) {
    activeAbort?.abort();
    await previousRun.catch(() => undefined);
  }
  const run = executeChat(input);
  activeRun = run;
  try {
    await run;
  } finally {
    if (activeRun === run) activeRun = undefined;
  }
}

async function createMainWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 960,
    minHeight: 640,
    title: brand.productName,
    icon: join(distDirectory(), "assets", "brand-logo.png"),
    autoHideMenuBar: true,
    backgroundColor: "#11161a",
    webPreferences: {
      preload: join(distDirectory(), "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true
    }
  });
  mainWindow.webContents.on("will-attach-webview", (event, webPreferences, params) => {
    if (!isAllowedPreviewUrl(params.src)) {
      event.preventDefault();
      return;
    }
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
  });
  mainWindow.webContents.on("did-attach-webview", (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (isAllowedPreviewUrl(url) && url !== "about:blank") void shell.openExternal(url);
      return { action: "deny" };
    });
    contents.on("will-navigate", (event, url) => {
      if (!isAllowedPreviewUrl(url)) event.preventDefault();
    });
  });
  await mainWindow.loadFile(join(distDirectory(), "index.html"));
  mainWindow.on("closed", () => { mainWindow = undefined; });
}

if (process.platform === "win32") app.setAppUserModelId(`com.${brand.productSlug}.desktop`);

app.whenReady().then(async () => {
  await loadPersistedState();
  protocol.handle("truss-media", workspaceMediaResponse);
  if (persisted.configuration) await configureRuntime(persisted.configuration);
  await createMainWindow();
  configureUpdater();
  app.on("activate", () => { if (!mainWindow) void createMainWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => {
  stopManagedDevServer();
  void stopTrussGo();
  void disposeRuntime();
});

ipcMain.handle("truss:initial-state", (): DesktopState => persisted);
ipcMain.handle("truss:configure-theme", async (_event, theme: DesktopThemePreference): Promise<DesktopState> => {
  if (!isThemePreference(theme)) throw new Error("Choose a valid desktop theme and use #RRGGBB colors for custom palette values.");
  persisted = { ...persisted, theme: theme.name === "custom" ? { name: "custom", custom: theme.custom ?? {} } : { name: theme.name } };
  await persistState();
  return persisted;
});
ipcMain.handle("truss:configure-updates", async (_event, updates: { readonly checkOnLaunch: boolean; readonly autoDownload: boolean }): Promise<DesktopState> => {
  persisted = {
    ...persisted,
    updates: {
      checkOnLaunch: updates.checkOnLaunch !== false,
      autoDownload: updates.autoDownload === true
    }
  };
  autoUpdater.autoDownload = persisted.updates.autoDownload;
  await persistState();
  return persisted;
});
ipcMain.handle("truss:check-for-updates", async (): Promise<void> => {
  if (!updaterSupported()) throw new Error("In-app updates are available in installed Windows and Linux AppImage builds. Update this package through its installer or package manager.");
  await autoUpdater.checkForUpdates();
});
ipcMain.handle("truss:download-update", async (): Promise<void> => {
  if (!updaterSupported()) throw new Error("In-app updates are available in installed Windows and Linux AppImage builds. Update this package through its installer or package manager.");
  await autoUpdater.downloadUpdate();
});
ipcMain.handle("truss:install-update", (): void => {
  if (!updaterSupported()) throw new Error("In-app updates are available in installed Windows and Linux AppImage builds. Update this package through its installer or package manager.");
  autoUpdater.quitAndInstall(false, true);
});
ipcMain.handle("truss:choose-workspace", async (): Promise<DesktopState | undefined> => {
  const options: OpenDialogOptions = { properties: ["openDirectory"] };
  const selection = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
  const workspaceRoot = selection.filePaths[0];
  if (selection.canceled || !workspaceRoot) return undefined;
  stopManagedDevServer();
  const workspaceChanged = resolve(workspaceRoot) !== resolve(persisted.workspaceRoot);
  persisted = { ...persisted, workspaceRoot, workspaceUiState: workspaceChanged ? undefined : persisted.workspaceUiState };
  if (persisted.configuration) await configureRuntime(persisted.configuration);
  await persistState();
  return persisted;
});
ipcMain.handle("truss:save-conversations", async (_event, conversations: readonly DesktopConversation[], activeConversationId?: string): Promise<void> => {
  persisted = { ...persisted, conversations: conversations.slice(0, 30), activeConversationId };
  await persistState();
});
ipcMain.handle("truss:discover-models", async (_event, partial?: Partial<DesktopConfiguration>) => {
  const configuration = partial?.baseUrl && isLocalEndpointKind(partial.provider)
    ? { provider: partial.provider, baseUrl: partial.baseUrl }
    : persisted.configuration && isLocalConfiguration(persisted.configuration) ? { provider: persisted.configuration.provider, baseUrl: persisted.configuration.baseUrl } : undefined;
  const endpoints = await detectLocalEndpoints();
  const endpoint = configuration ? localEndpoint(configuration) : endpoints[0];
  let models: readonly string[] = [];
  if (endpoint) {
    try { models = (await listLocalModels(endpoint)).map((model) => model.name); } catch { /* Manual models remain available. */ }
  }
  return { endpoints: endpoints as readonly DesktopEndpoint[], models };
});
ipcMain.handle("truss:refresh-local-model", async (): Promise<DesktopState> => {
  const endpoints = await detectLocalEndpoints();
  const current = persisted.configuration;
  const matchingEndpoint = current && endpoints.find((endpoint) => endpoint.kind === current.provider && endpoint.baseUrl === current.baseUrl);
  const selected = matchingEndpoint
    ? { endpoint: matchingEndpoint, model: (await listLocalModels(matchingEndpoint))[0] }
    : await detectActiveLocalModel({ endpoints });
  if (!selected?.model) throw new Error("No loaded local model was detected. Start a local server and load a model, then refresh.");
  let next = normalizeConfiguration({
    ...(current ?? { mode: "chat" as const, permission: "ask" as const, contextWindow: 8_192, internetAccess: false, mcpServers: {} }),
    provider: selected.endpoint.kind,
    baseUrl: selected.endpoint.baseUrl,
    model: selected.model.name
  });
  const contextWindow = await detectLocalContextWindow(selected.endpoint, selected.model.name).catch(() => undefined);
  if (contextWindow) next = { ...next, contextWindow };
  const previous = persisted.configuration;
  persisted = { ...persisted, configuration: next };
  await configureRuntime(next);
  if (previous?.model !== next.model || previous?.baseUrl !== next.baseUrl || previous?.provider !== next.provider) void releaseOllamaModel(previous);
  await persistState();
  return persisted;
});
ipcMain.handle("truss:configure", async (_event, input: DesktopConfiguration, apiKey?: string): Promise<DesktopState> => {
  let next = normalizeConfiguration(input);
  if (!next.baseUrl || !next.model) throw new Error("An endpoint and model are required.");
  if (apiKey?.trim()) await saveCredential(next.provider, apiKey.trim());
  if (isCloudProviderId(next.provider) && !(await storedCredential(next.provider))) {
    throw new Error(`Enter an API key for ${cloudProviderDefinition(next.provider).label}.`);
  }
  const detectedContextWindow = isLocalConfiguration(next)
    ? await detectLocalContextWindow(localEndpoint(next), next.model).catch(() => undefined)
    : undefined;
  if (detectedContextWindow) next = { ...next, contextWindow: detectedContextWindow };
  const previous = persisted.configuration;
  persisted = { ...persisted, configuration: next };
  await configureRuntime(next);
  if (previous?.model !== next.model || previous?.baseUrl !== next.baseUrl || previous?.provider !== next.provider) void releaseOllamaModel(previous);
  await persistState();
  return persisted;
});
ipcMain.handle("truss:save-workspace-ui-state", async (_event, state: DesktopWorkspaceUiState): Promise<void> => {
  persisted = { ...persisted, workspaceUiState: normalizeWorkspaceUiState(state) };
  await persistState();
});
ipcMain.handle("truss:clear-credential", async (_event, provider: DesktopProvider): Promise<void> => {
  if (!isCloudProviderId(provider)) return;
  await removeCredential(provider);
  if (persisted.configuration?.provider === provider) await disposeRuntime();
});
ipcMain.handle("truss:send-chat", (_event, input) => runChat(input));
ipcMain.handle("truss:stop-chat", (): void => activeAbort?.abort());
ipcMain.handle("truss:resolve-approval", (_event, callId: string, approved: boolean): void => {
  approvalResolvers.get(callId)?.(approved);
  approvalResolvers.delete(callId);
});
ipcMain.handle("truss:list-files", () => collectFiles());
ipcMain.handle("truss:list-directory", (_event, path: string) => listDirectory(path));
ipcMain.handle("truss:read-file", async (_event, path: string): Promise<string> => readFile(ensurePathInsideWorkspace(path), "utf8"));
ipcMain.handle("truss:write-file", async (_event, path: string, content: string): Promise<void> => {
  if (typeof content !== "string") throw new Error("File content must be text.");
  if (content.length > 5_000_000) throw new Error("Files larger than 5 MB cannot be edited in Truss.");
  await writeFile(ensurePathInsideWorkspace(path), content, "utf8");
});
ipcMain.handle("truss:create-workspace-file", async (_event, path: string): Promise<void> => {
  const target = ensurePathInsideWorkspace(path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, "", { encoding: "utf8", flag: "wx" });
});
ipcMain.handle("truss:create-workspace-folder", async (_event, path: string): Promise<void> => {
  await mkdir(ensurePathInsideWorkspace(path));
});
ipcMain.handle("truss:rename-workspace-entry", async (_event, path: string, nextPath: string): Promise<void> => {
  await rename(ensurePathInsideWorkspace(path), ensurePathInsideWorkspace(nextPath));
});
ipcMain.handle("truss:copy-workspace-entry", async (_event, path: string, destinationPath: string): Promise<void> => {
  const source = ensurePathInsideWorkspace(path);
  const destination = ensurePathInsideWorkspace(destinationPath);
  if ((await stat(source)).isDirectory()) throw new Error("Copying folders is not supported yet. Create a folder and copy its files instead.");
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination, 1);
});
ipcMain.handle("truss:delete-workspace-entry", async (_event, path: string): Promise<void> => {
  const target = ensurePathInsideWorkspace(path);
  if (resolve(target) === resolve(persisted.workspaceRoot)) throw new Error("The workspace root cannot be deleted.");
  await rm(target, { recursive: true, force: false });
});
ipcMain.handle("truss:reveal-workspace-entry", (_event, path: string): void => { shell.showItemInFolder(ensurePathInsideWorkspace(path)); });
ipcMain.handle("truss:diff-file", async (_event, path: string): Promise<string> => {
  const target = ensurePathInsideWorkspace(path);
  const relativePath = relative(persisted.workspaceRoot, target);
  const againstHead = await gitOutput(["diff", "--no-ext-diff", "HEAD", "--", relativePath]);
  if (againstHead) return againstHead;
  const staged = await gitOutput(["diff", "--cached", "--no-ext-diff", "--", relativePath]);
  const workingTree = await gitOutput(["diff", "--no-ext-diff", "--", relativePath]);
  if (staged || workingTree) return [staged, workingTree].filter(Boolean).join("\n");
  const tracked = await gitOutput(["ls-files", "--error-unmatch", "--", relativePath]);
  if (!tracked) {
    const untracked = await gitOutput(["diff", "--no-index", "--", "/dev/null", relativePath]);
    if (untracked) return untracked;
  }
  return "No Git diff for this file.";
});
ipcMain.handle("truss:get-plan", () => new FileWorkspacePlanStore(persisted.workspaceRoot).load());
ipcMain.handle("truss:git-status", () => getGitStatus());
ipcMain.handle("truss:git-stage", async (_event, paths: readonly string[]): Promise<string> => gitCommand(["add", "--", ...gitPaths(paths)]));
ipcMain.handle("truss:git-unstage", async (_event, paths: readonly string[]): Promise<string> => {
  const selected = gitPaths(paths);
  try {
    return await gitCommand(["restore", "--staged", "--", ...selected]);
  } catch {
    return gitCommand(["rm", "--cached", "--", ...selected]);
  }
});
ipcMain.handle("truss:git-discard", async (_event, paths: readonly string[]): Promise<string> => {
  const selected = gitPaths(paths);
  const tracked: string[] = [];
  const stagedNew: string[] = [];
  const untracked: string[] = [];
  for (const path of selected) {
    if (await gitPathExistsAtHead(path)) {
      tracked.push(path);
    } else if ((await gitOutput(["diff", "--cached", "--name-only", "--", path])).trim()) {
      stagedNew.push(path);
    } else {
      untracked.push(path);
    }
  }
  const output: string[] = [];
  if (tracked.length) output.push(await gitCommand(["restore", "--source=HEAD", "--staged", "--worktree", "--", ...tracked]));
  if (stagedNew.length) {
    try {
      output.push(await gitCommand(["restore", "--staged", "--", ...stagedNew]));
    } catch {
      output.push(await gitCommand(["rm", "--cached", "--", ...stagedNew]));
    }
  }
  const removable = [...stagedNew, ...untracked];
  if (removable.length) output.push(await gitCommand(["clean", "-f", "-d", "--", ...removable]));
  return output.filter(Boolean).join("\n") || "Discarded selected changes.";
});
ipcMain.handle("truss:git-generate-commit-message", () => generateCommitMessage());
ipcMain.handle("truss:git-commit", async (_event, message: string): Promise<string> => {
  if (typeof message !== "string" || !message.trim()) throw new Error("Enter a commit message.");
  return gitCommand(["commit", "-m", message.trim()]);
});
ipcMain.handle("truss:git-pull", (): Promise<string> => gitCommand(["pull"]));
ipcMain.handle("truss:git-push", (): Promise<string> => gitCommand(["push"]));
ipcMain.handle("truss:run-terminal", async (_event, command: string): Promise<string> => {
  const commandId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const normalized = typeof command === "string" ? command.trim() : "";
  if (!normalized) throw new Error("Enter a terminal command.");
  if (normalized.length > 20_000) throw new Error("The terminal command is too long.");
  if (normalized.startsWith("/")) {
    try {
      const result = await executeWorkspaceCommand({ workspaceRoot: persisted.workspaceRoot, input: normalized });
      send({ type: "terminal-output", commandId, text: `${result.message}\n\n[workspace command ${result.ok ? "completed" : "failed"}]\n` });
    } catch (error) {
      send({ type: "terminal-output", commandId, text: `[workspace command failed] ${error instanceof Error ? error.message : String(error)}\n` });
    }
    return commandId;
  }
  const child = spawn(normalized, { cwd: persisted.workspaceRoot, shell: true, windowsHide: true });
  child.stdout.on("data", (data: Buffer) => send({ type: "terminal-output", commandId, text: data.toString() }));
  child.stderr.on("data", (data: Buffer) => send({ type: "terminal-output", commandId, text: data.toString() }));
  child.on("error", (error) => send({ type: "terminal-output", commandId, text: `\n[terminal error] ${error.message}\n` }));
  child.on("close", (code) => send({ type: "terminal-output", commandId, text: `\n[process exited: ${code ?? "unknown"}]\n` }));
  return commandId;
});
ipcMain.handle("truss:start-dev-server", (_event, command: string): string => {
  const normalized = typeof command === "string" ? command.trim() : "";
  if (!normalized) throw new Error("Enter a dev-server command.");
  if (normalized.length > 2_000) throw new Error("The dev-server command is too long.");
  stopManagedDevServer();
  const commandId = `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const child = spawn(normalized, {
    cwd: persisted.workspaceRoot,
    shell: true,
    windowsHide: true,
    env: { ...process.env, FORCE_COLOR: "0" }
  });
  devServerProcess = child;
  let announcedUrl: string | undefined;
  send({ type: "dev-server", status: "starting", command: normalized });
  child.once("spawn", () => {
    if (devServerProcess === child) send({ type: "dev-server", status: "running", command: normalized });
  });
  const output = (text: string): void => {
    send({ type: "terminal-output", commandId, text });
    const url = detectedPreviewUrl(text);
    if (url && url !== announcedUrl && devServerProcess === child) {
      announcedUrl = url;
      send({ type: "dev-server", status: "running", command: normalized, url });
    }
  };
  child.stdout.on("data", (data: Buffer) => output(data.toString()));
  child.stderr.on("data", (data: Buffer) => output(data.toString()));
  child.on("error", (error) => {
    if (devServerProcess === child) {
      devServerProcess = undefined;
    }
    send({ type: "dev-server", status: "failed", command: normalized, message: error.message });
  });
  child.on("close", (code) => {
    if (devServerProcess !== child) return;
    devServerProcess = undefined;
    send({
      type: "dev-server",
      status: code === 0 ? "stopped" : "failed",
      command: normalized,
      message: code === 0 ? undefined : `Dev server exited with code ${code ?? "unknown"}.`
    });
  });
  return commandId;
});
ipcMain.handle("truss:stop-dev-server", (): void => stopManagedDevServer());
ipcMain.handle("truss:open-external", async (_event, value: string): Promise<void> => {
  await shell.openExternal(validatedPreviewUrl(value));
});
ipcMain.handle("truss:connect-truss-go", () => connectTrussGo());
ipcMain.handle("truss:disconnect-truss-go", () => stopTrussGo());
