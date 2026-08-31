import { execFile as execFileCallback } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { brand } from "@truss-harness/branding";
import {
  cloudProviderDefinition,
  generateCloudText,
  generateLocalText,
  isCloudProviderId,
} from "@truss-harness/provider-openai-compatible";
import {
  ApiKeyCredential,
  executeWorkspaceCommand,
  FileWorkspacePlanStore,
} from "@truss-harness/runtime";
import {
  app,
  dialog,
  ipcMain,
  type OpenDialogOptions,
  protocol,
  safeStorage,
  shell,
} from "electron";
import { autoUpdater } from "electron-updater";
import { configureLinuxCredentialStorage } from "./credential-storage.js";
import { CredentialService } from "./main/credential-service.js";
import { isLocalConfiguration } from "./main/desktop-configuration.js";
import {
  DesktopStateStore,
  defaultDesktopState,
} from "./main/desktop-state-store.js";
import { TrussGoGatewayService } from "./main/gateway-service.js";
import { GitService } from "./main/git-service.js";
import {
  registerOperationalIpc,
  registerSettingsIpc,
} from "./main/ipc-registration.js";
import { ManagedAgentService } from "./main/managed-agent-service.js";
import { DesktopRuntimeService } from "./main/runtime-service.js";
import { DesktopSettingsService } from "./main/settings-service.js";
import { TerminalService } from "./main/terminal-service.js";
import { DesktopUpdateService } from "./main/update-service.js";
import {
  DesktopWindowService,
  validatedPreviewUrl,
} from "./main/window-service.js";
import { WorkspaceService } from "./main/workspace-service.js";
import type { DesktopConfiguration, DesktopEvent } from "./shared.js";

const execFile = promisify(execFileCallback);

protocol.registerSchemesAsPrivileged([
  {
    scheme: "truss-media",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

let persisted = defaultDesktopState(process.cwd());
let stateStore: DesktopStateStore | undefined;
const workspaceService = new WorkspaceService(() => persisted.workspaceRoot);
const credentialService = new CredentialService(
  () => credentialPath(),
  () => persisted.providerAccounts ?? [],
  {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (value) => safeStorage.encryptString(value),
    decrypt: (value) => safeStorage.decryptString(value),
  },
);
const runtimeService = new DesktopRuntimeService(
  () => persisted,
  (state) => {
    persisted = state;
  },
  (reference) => credentialService.get(reference),
  workspaceService,
  send,
  () => join(app.getPath("userData"), "runtime-host"),
);
const managedAgents = new ManagedAgentService(
  () => persisted,
  (state) => {
    persisted = state;
  },
  persistState,
  (reference) => credentialService.get(reference),
  send,
);
const trussGo = new TrussGoGatewayService(
  () => persisted,
  () => managedAgents.coordinator,
  runtimeService,
);
const gitService = new GitService(
  () => persisted.workspaceRoot,
  (path) => workspaceService.resolvePath(path),
  async (command, args, options) => execFile(command, [...args], options),
  () => persisted.configuration,
  generateConfiguredText,
);
const updateService = new DesktopUpdateService(
  {
    isPackaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    appImage: process.env.APPIMAGE,
    resourcesPath: process.resourcesPath,
    getVersion: () => app.getVersion(),
  },
  autoUpdater,
  () => persisted.updates,
  send,
  (url) => shell.openExternal(url),
);
const terminalService = new TerminalService(
  () => persisted.workspaceRoot,
  send,
  executeWorkspaceCommand,
);
const windowService = new DesktopWindowService(
  distDirectory,
  brand.productName,
  () => persisted.zoomFactor,
  () => void trussGo.stop(),
);
const settingsService = new DesktopSettingsService(
  () => persisted,
  (state) => {
    persisted = state;
  },
  persistState,
  credentialService,
  runtimeService,
  managedAgents,
  updateService,
  async () => {
    const options: OpenDialogOptions = { properties: ["openDirectory"] };
    windowService.focus();
    const selection = windowService.current
      ? await dialog.showOpenDialog(windowService.current, options)
      : await dialog.showOpenDialog(options);
    return selection.canceled ? undefined : selection.filePaths[0];
  },
  (zoomFactor) => windowService.setZoomFactor(zoomFactor),
);
function send(event: DesktopEvent): void {
  windowService.send("truss:event", event);
}

function shutdownDesktopWork(): void {
  runtimeService.stop();
  void managedAgents.dispose();
  terminalService.stopAll();
  windowService.closeWebviews();
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

async function storedCredential(
  reference: string,
): Promise<string | undefined> {
  return credentialService.get(reference);
}

async function generateConfiguredText(
  configuration: DesktopConfiguration,
  prompt: string,
  model = configuration.model,
): Promise<string> {
  if (isLocalConfiguration(configuration))
    return generateLocalText(
      {
        kind: configuration.provider,
        baseUrl: configuration.baseUrl,
        model,
      },
      prompt,
    );
  if (!isCloudProviderId(configuration.provider))
    throw new Error("Choose a supported model provider.");
  const credential = await storedCredential(
    configuration.credentialAccountId ?? configuration.provider,
  );
  if (!credential)
    throw new Error(
      `Enter an API key for ${cloudProviderDefinition(configuration.provider).label}.`,
    );
  return generateCloudText(
    {
      provider: configuration.provider,
      model,
      credential: new ApiKeyCredential(
        `desktop:generation:${configuration.provider}`,
        credential,
      ),
    },
    prompt,
  );
}

async function loadPersistedState(): Promise<void> {
  stateStore = new DesktopStateStore(statePath(), process.cwd());
  persisted = await stateStore.load();
}

async function persistState(): Promise<void> {
  stateStore ??= new DesktopStateStore(statePath(), process.cwd());
  await stateStore.save(persisted);
}

if (process.platform === "win32")
  app.setAppUserModelId(`com.${brand.productSlug}.desktop`);

configureLinuxCredentialStorage(
  process.platform,
  (name, value) => app.commandLine.appendSwitch(name, value),
  process.argv.some(
    (argument) =>
      argument === "--password-store" ||
      argument.startsWith("--password-store="),
  ),
);

void app
  .whenReady()
  .then(async () => {
    await loadPersistedState();
    protocol.handle("truss-media", (request) =>
      workspaceService.mediaResponse(request),
    );
    await managedAgents.configure();
    await settingsService.configureStartupRuntime();
    await windowService.create();
    updateService.configure();
    app.on("activate", () => {
      if (!windowService.current) void windowService.create();
    });
  })
  .catch((error: unknown) => {
    console.error(
      "Desktop startup failed:",
      error instanceof Error ? error.message : String(error),
    );
    app.quit();
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  shutdownDesktopWork();
  void trussGo.stop();
  void runtimeService.dispose();
});

registerSettingsIpc(ipcMain, settingsService, () => persisted);
ipcMain.handle("truss:app-version", () => app.getVersion());

async function complete(input: {
  readonly prefix?: unknown;
  readonly suffix?: unknown;
  readonly path?: unknown;
}): Promise<string> {
  const configuration = persisted.configuration;
  if (!configuration?.autocomplete?.enabled) return "";
  const prefix =
    typeof input.prefix === "string" ? input.prefix.slice(-6_000) : "";
  const suffix =
    typeof input.suffix === "string" ? input.suffix.slice(0, 1_500) : "";
  if (!prefix.trim()) return "";
  const model = configuration.autocomplete.model || configuration.model;
  const filePath = typeof input.path === "string" ? input.path : "unknown";
  const prompt = `Complete the code at the cursor. Return ONLY the text to insert, with no Markdown, explanation, or repeated context.

File: ${filePath}

Before cursor:
${prefix}

After cursor:
${suffix}`;
  const completion = await generateConfiguredText(configuration, prompt, model);
  return completion
    .replace(/^```[\w-]*\s*/i, "")
    .replace(/\s*```$/, "")
    .replace(/\r\n/g, "\n")
    .slice(0, 4_000);
}

async function formatFile(path: string, content: string): Promise<string> {
  workspaceService.resolvePath(path);
  if (typeof content !== "string" || content.length > 5_000_000)
    throw new Error("File content is invalid or too large to format.");
  try {
    const prettier = await import("prettier");
    return prettier.format(content, { filepath: path });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const escapeCharacter = String.fromCharCode(27);
    throw new Error(
      message.replace(
        new RegExp(`${escapeCharacter}\\[[0-?]*[ -/]*[@-~]`, "g"),
        "",
      ),
    );
  }
}

async function checkSyntax(
  path: string,
  content: string,
): Promise<readonly { readonly line: number; readonly message: string }[]> {
  workspaceService.resolvePath(path);
  if (typeof content !== "string") return [];
  try {
    const prettier = await import("prettier");
    await prettier.format(content, { filepath: path });
    return [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/no parser could be inferred/i.test(message)) return [];
    const line = Number(message.match(/\((\d+):(\d+)\)/)?.[1] ?? "1");
    return [
      { line, message: message.replace(/\s*\(\d+:\d+\).*$/s, "").trim() },
    ];
  }
}

registerOperationalIpc({
  ipc: ipcMain,
  runtime: runtimeService,
  agents: managedAgents,
  workspace: workspaceService,
  git: gitService,
  terminal: terminalService,
  gateway: trussGo,
  revealPath: (path) => shell.showItemInFolder(path),
  openExternal: (value) => shell.openExternal(validatedPreviewUrl(value)),
  loadPlan: () => new FileWorkspacePlanStore(persisted.workspaceRoot).load(),
  complete,
  formatFile,
  checkSyntax,
});
