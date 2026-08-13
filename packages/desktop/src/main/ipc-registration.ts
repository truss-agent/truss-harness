import type { TrussGoGatewayService } from "./gateway-service.js";
import type { GitService } from "./git-service.js";
import type { ManagedAgentService } from "./managed-agent-service.js";
import type { DesktopRuntimeService } from "./runtime-service.js";
import type { DesktopSettingsService } from "./settings-service.js";
import type { TerminalService } from "./terminal-service.js";
import type { WorkspaceService } from "./workspace-service.js";

type IpcRegistrar = Pick<IpcMain, "handle">;

export interface OperationalIpcDependencies {
  readonly ipc: IpcRegistrar;
  readonly runtime: DesktopRuntimeService;
  readonly agents: ManagedAgentService;
  readonly workspace: WorkspaceService;
  readonly git: GitService;
  readonly terminal: TerminalService;
  readonly gateway: TrussGoGatewayService;
  readonly revealPath: (path: string) => void;
  readonly openExternal: (value: string) => Promise<void>;
  readonly loadPlan: () => Promise<unknown>;
  readonly complete: (input: {
    readonly prefix?: unknown;
    readonly suffix?: unknown;
    readonly path?: unknown;
  }) => Promise<string>;
  readonly formatFile: (path: string, content: string) => Promise<string>;
  readonly checkSyntax: (
    path: string,
    content: string,
  ) => Promise<readonly { readonly line: number; readonly message: string }[]>;
}

export function registerOperationalIpc({
  ipc,
  runtime,
  agents,
  workspace,
  git,
  terminal,
  gateway,
  revealPath,
  openExternal,
  loadPlan,
  complete,
  formatFile,
  checkSyntax,
}: OperationalIpcDependencies): void {
  ipc.handle("truss:send-chat", (_event, input) => runtime.runChat(input));
  ipc.handle("truss:stop-chat", () => runtime.stop());
  ipc.handle("truss:list-agents", () => agents.snapshot());
  ipc.handle("truss:create-agent", (_event, input) => agents.create(input));
  ipc.handle("truss:update-agent", (_event, id, input) =>
    agents.update(id, input),
  );
  ipc.handle("truss:delete-agent", (_event, id) => agents.delete(id));
  ipc.handle("truss:start-agent", (_event, id, prompt) =>
    agents.start(id, prompt),
  );
  ipc.handle("truss:stop-agent", (_event, runId) => agents.stop(runId));
  ipc.handle("truss:stop-all-agents", () => agents.stopAll());
  ipc.handle(
    "truss:resolve-agent-approval",
    (_event, runId, callId, approved) =>
      agents.resolveApproval(runId, callId, approved),
  );
  ipc.handle(
    "truss:resolve-approval",
    (_event, callId, approved, allowAllForSession = false) =>
      runtime.resolveApproval(callId, approved, allowAllForSession),
  );

  ipc.handle("truss:list-files", () => workspace.collectFiles());
  ipc.handle("truss:list-directory", (_event, path) =>
    workspace.listDirectory(path),
  );
  ipc.handle("truss:read-file", (_event, path) => workspace.readFile(path));
  ipc.handle("truss:write-file", (_event, path, content) =>
    workspace.writeFile(path, content),
  );
  ipc.handle("truss:create-workspace-file", (_event, path) =>
    workspace.createFile(path),
  );
  ipc.handle("truss:create-workspace-folder", (_event, path) =>
    workspace.createFolder(path),
  );
  ipc.handle("truss:rename-workspace-entry", (_event, path, nextPath) =>
    workspace.rename(path, nextPath),
  );
  ipc.handle("truss:copy-workspace-entry", (_event, path, destinationPath) =>
    workspace.copy(path, destinationPath),
  );
  ipc.handle("truss:delete-workspace-entry", (_event, path) =>
    workspace.delete(path),
  );
  ipc.handle("truss:reveal-workspace-entry", (_event, path) =>
    revealPath(workspace.resolvePath(path)),
  );
  ipc.handle("truss:diff-file", (_event, path) => git.diffFile(path));
  ipc.handle("truss:get-plan", () => loadPlan());

  ipc.handle("truss:git-status", () => git.status());
  ipc.handle("truss:git-graph", () => git.graph());
  ipc.handle("truss:git-stage", (_event, paths) => git.stage(paths));
  ipc.handle("truss:git-unstage", (_event, paths) => git.unstage(paths));
  ipc.handle("truss:git-discard", (_event, paths) => git.discard(paths));
  ipc.handle("truss:git-generate-commit-message", () =>
    git.generateCommitMessage(),
  );
  ipc.handle("truss:git-commit", (_event, message) => git.commit(message));
  ipc.handle("truss:git-pull", () => git.pull());
  ipc.handle("truss:git-push", () => git.push());

  ipc.handle("truss:run-terminal", (_event, command) => terminal.run(command));
  ipc.handle("truss:stop-terminal", () => terminal.stopAll());
  ipc.handle("truss:open-external", (_event, value) => openExternal(value));
  ipc.handle("truss:connect-truss-go", () => gateway.connect());
  ipc.handle("truss:disconnect-truss-go", () => gateway.stop());
  ipc.handle("truss:complete", (_event, input) => complete(input));
  ipc.handle("truss:format-file", (_event, path, content) =>
    formatFile(path, content),
  );
  ipc.handle("truss:check-syntax", (_event, path, content) =>
    checkSyntax(path, content),
  );
}

export function registerSettingsIpc(
  ipc: IpcRegistrar,
  settings: DesktopSettingsService,
  initialState: () => unknown,
): void {
  ipc.handle("truss:initial-state", () => initialState());
  ipc.handle("truss:test-mcp-server", (_event, name, input) =>
    settings.testMcpServer(name, input),
  );
  ipc.handle("truss:credential-storage", () => settings.credentialStorage());
  ipc.handle("truss:configure-theme", (_event, theme) =>
    settings.configureTheme(theme),
  );
  ipc.handle("truss:adjust-zoom", (_event, direction) =>
    settings.adjustZoom(direction),
  );
  ipc.handle("truss:configure-updates", (_event, updates) =>
    settings.configureUpdates(updates),
  );
  ipc.handle("truss:check-for-updates", () => settings.checkForUpdates());
  ipc.handle("truss:download-update", () => settings.downloadUpdate());
  ipc.handle("truss:install-update", () => settings.installUpdate());
  ipc.handle("truss:choose-workspace", () => settings.chooseWorkspace());
  ipc.handle(
    "truss:save-conversations",
    (_event, conversations, activeConversationId) =>
      settings.saveConversations(conversations, activeConversationId),
  );
  ipc.handle("truss:discover-models", (_event, partial, apiKey) =>
    settings.discoverModels(partial, apiKey),
  );
  ipc.handle("truss:refresh-local-model", () => settings.refreshLocalModel());
  ipc.handle("truss:configure", (_event, input, apiKey) =>
    settings.configure(input, apiKey),
  );
  ipc.handle("truss:test-provider-connection", (_event, input, apiKey) =>
    settings.testProviderConnection(input, apiKey),
  );
  ipc.handle("truss:save-workspace-ui-state", (_event, state) =>
    settings.saveWorkspaceUiState(state),
  );
  ipc.handle("truss:clear-credential", (_event, provider, accountId) =>
    settings.clearCredential(provider, accountId),
  );
  ipc.handle("truss:save-provider-account", (_event, input, apiKey) =>
    settings.saveProviderAccount(input, apiKey),
  );
  ipc.handle("truss:update-provider-account", (_event, id, input) =>
    settings.updateProviderAccount(id, input),
  );
  ipc.handle("truss:delete-provider-account", (_event, id) =>
    settings.deleteProviderAccount(id),
  );
}

import type { IpcMain } from "electron";
