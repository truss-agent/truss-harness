import { brand } from "@truss-harness/branding";
import {
  detectLocalContextWindow,
  type ModelProviderKind,
} from "@truss-harness/provider-openai-compatible";
import {
  type ProviderAccount,
  validateMasterPrompt,
} from "@truss-harness/runtime";
import * as vscode from "vscode";
import { ChatRuntimeController } from "./chat-runtime-controller.js";
import type {
  ModelConfiguration,
  StoredConversationState,
  WebviewRequest,
} from "./contracts.js";
import { normalizeConversationState } from "./conversation-state.js";
import { GitCommitController } from "./git-commit.js";
import { InlineCompletionController } from "./inline-completion.js";
import { InlineResponseBuffer } from "./inline-responses.js";
import { ManagedAgentController } from "./managed-agents.js";
import {
  isConfiguration,
  isLocalConfiguration,
  localEndpoint,
  normalizeConfiguration,
  releaseOllamaModel,
} from "./model-configuration.js";
import { ProviderAccountStore } from "./provider-accounts.js";
import { ProviderCommandController } from "./provider-commands.js";
import { ProviderController } from "./provider-controller.js";
import { TrussGoController } from "./truss-go-controller.js";
import { UpdateController } from "./update-controller.js";
import { webviewHtml } from "./webview-html.js";
import { WorkspaceCommandController } from "./workspace-commands.js";
import {
  activeWorkspacePlan,
  workspaceFiles,
  workspaceRoot,
} from "./workspace-context.js";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel(brand.productName);
  const updates = new UpdateController(context, output);
  const inlineResponses = new InlineResponseBuffer();
  let configuration = normalizeConfiguration(
    context.workspaceState.get("modelConfiguration"),
  );
  let conversations = normalizeConversationState(
    context.workspaceState.get("conversations"),
  );
  const providerAccounts = new ProviderAccountStore(context);

  const providers = new ProviderController({
    context,
    accounts: providerAccounts,
    workspaceRoot,
    configuration: () => configuration,
    setConfiguration: async (next) => {
      configuration = next;
      await context.workspaceState.update("modelConfiguration", configuration);
    },
  });
  const providerApiKeyForReference = (
    provider: ModelProviderKind,
    reference?: string,
  ): Promise<string | undefined> =>
    providers.apiKeyForReference(provider, reference);
  const providerApiKey = (): Promise<string | undefined> => providers.apiKey();
  const runtimeEnvironment = (): Promise<NodeJS.ProcessEnv> =>
    providers.runtimeEnvironment();
  const showProviderConnectionResult = async (): Promise<void> => {
    const result = await providers.testConnection();
    const message = `${brand.productName}: ${result.message}`;
    if (result.status === "connected") {
      void vscode.window.showInformationMessage(message);
    } else {
      void vscode.window.showWarningMessage(message);
    }
  };
  const saveProviderAccount = async (
    provider: ModelProviderKind,
    apiKey: string,
    accountId?: string,
    accountLabel?: string,
    selectedConfiguration?: ModelConfiguration,
  ): Promise<ProviderAccount> => {
    const previous = configuration;
    const account = await providers.saveAccount(
      provider,
      apiKey,
      accountId,
      accountLabel,
      selectedConfiguration,
    );
    if (configuration !== previous) {
      chat.disposeService();
      await managedAgents.reset();
    }
    return account;
  };
  const removeProviderAccount = async (accountId: string): Promise<void> => {
    const previous = configuration;
    await providers.removeAccount(accountId);
    if (configuration !== previous) {
      chat.disposeService();
      await managedAgents.reset();
    }
  };

  const managedAgents = new ManagedAgentController({
    context,
    workspaceRoot,
    configuration: () => configuration,
    providerApiKey,
    providerApiKeyForReference,
  });
  context.subscriptions.push(
    managedAgents,
    ...managedAgents.registerCommands(),
  );

  const trussGo = new TrussGoController({
    context,
    configuration: () => configuration,
    runtimeEnvironment,
    workspaceRoot,
  });
  context.subscriptions.push(trussGo);

  const chat = new ChatRuntimeController({
    context,
    output,
    configuration: () => configuration,
    runtimeEnvironment,
    workspaceRoot,
    responses: inlineResponses,
  });
  context.subscriptions.push(chat);
  const post = (message: unknown): void => chat.post(message);
  const startService = () => chat.service();

  const sendState = async (
    selectedConfiguration?: ModelConfiguration,
    discoveryApiKey?: string,
  ): Promise<void> =>
    post({
      type: "state",
      state: await providers.state(selectedConfiguration, discoveryApiKey),
    });
  const sendConversationState = (): void =>
    post({ type: "conversations", state: conversations });
  const saveConversations = async (
    next: StoredConversationState,
  ): Promise<void> => {
    conversations = normalizeConversationState(next);
    await context.workspaceState.update("conversations", conversations);
  };

  const gitCommit = new GitCommitController(
    workspaceRoot,
    startService,
    inlineResponses,
    output,
  );

  const bindWebview = (webview: vscode.Webview): void => {
    webview.options = { enableScripts: true };
    webview.html = webviewHtml(webview, context.extensionUri);
    webview.onDidReceiveMessage(
      async (message: WebviewRequest) => {
        switch (message.type) {
          case "ready":
            sendConversationState();
            await sendState();
            post({ type: "workspaceFiles", files: await workspaceFiles() });
            post({ type: "plan", plan: await activeWorkspacePlan() });
            break;
          case "discover":
            await sendState(
              isConfiguration(message.configuration)
                ? normalizeConfiguration(message.configuration)
                : undefined,
              message.apiKey,
            );
            break;
          case "configure": {
            if (
              !isConfiguration(message.configuration) ||
              !message.configuration.baseUrl
            ) {
              post({
                type: "error",
                message: "Choose a provider, endpoint, and model.",
              });
              break;
            }
            const previousConfiguration = configuration;
            const nextConfiguration = normalizeConfiguration(
              message.configuration,
            );
            const masterPromptValidation = validateMasterPrompt(
              nextConfiguration.masterPrompt,
            );
            if (!masterPromptValidation.valid) {
              post({
                type: "error",
                message: masterPromptValidation.errors.join(" "),
              });
              break;
            }
            configuration = nextConfiguration;
            const detectedContextWindow = isLocalConfiguration(configuration)
              ? await detectLocalContextWindow(
                  localEndpoint(configuration),
                  configuration.model,
                ).catch(() => undefined)
              : undefined;
            if (detectedContextWindow)
              configuration = {
                ...configuration,
                contextWindow: detectedContextWindow,
              };
            await context.workspaceState.update(
              "modelConfiguration",
              configuration,
            );
            chat.disposeService();
            await managedAgents.reset();
            if (
              previousConfiguration.model !== configuration.model ||
              previousConfiguration.provider !== configuration.provider ||
              previousConfiguration.baseUrl !== configuration.baseUrl
            ) {
              void releaseOllamaModel(previousConfiguration);
            }
            post({ type: "runtimeReset" });
            await sendState();
            break;
          }
          case "saveProviderAccount":
            try {
              if (!isConfiguration(message.configuration)) {
                throw new Error(
                  "Choose a provider endpoint and model before saving its account.",
                );
              }
              const account = await saveProviderAccount(
                message.provider,
                message.apiKey,
                message.accountId,
                message.accountLabel,
                normalizeConfiguration(message.configuration),
              );
              post({
                type: "providerAccountSaved",
                accountId: account.id,
                message: `${account.label} is stored securely in VS Code.`,
              });
              await sendState();
            } catch (error) {
              post({
                type: "providerAccountError",
                message: error instanceof Error ? error.message : String(error),
              });
            }
            break;
          case "removeProviderAccount":
            try {
              await removeProviderAccount(message.accountId);
              post({
                type: "providerAccountRemoved",
                message: "Stored provider key removed.",
              });
              await sendState();
            } catch (error) {
              post({
                type: "providerAccountError",
                message: error instanceof Error ? error.message : String(error),
              });
            }
            break;
          case "testProviderConnection":
            try {
              if (!isConfiguration(message.configuration)) {
                throw new Error(
                  "Choose a provider, endpoint, and model before testing.",
                );
              }
              const result = await providers.testConnection(
                normalizeConfiguration(message.configuration),
                message.apiKey,
              );
              post({
                type: "connectionResult",
                status: result.status,
                message: result.message,
              });
            } catch (error) {
              post({
                type: "connectionResult",
                status: "failed",
                message: error instanceof Error ? error.message : String(error),
              });
            }
            break;
          case "send":
            await chat.sendPrompt(
              message.prompt,
              message.conversationId,
              message.history,
              message.attachments,
              message.attachedPaths,
            );
            break;
          case "stop":
            chat.stop(message.conversationId);
            break;
          case "newConversation":
            post({ type: "conversationReset" });
            break;
          case "selectConversation":
            break;
          case "deleteConversation": {
            const wasActive = conversations.activeId === message.conversationId;
            chat.delete(message.conversationId);
            conversations = normalizeConversationState({
              conversations: conversations.conversations.filter(
                (conversation) => conversation.id !== message.conversationId,
              ),
              activeId: wasActive
                ? conversations.conversations.find(
                    (conversation) =>
                      conversation.id !== message.conversationId,
                  )?.id
                : conversations.activeId,
            });
            await context.workspaceState.update("conversations", conversations);
            sendConversationState();
            break;
          }
          case "saveConversations":
            await saveConversations(message.state);
            break;
          case "toolApproval":
            chat.approve(
              message.conversationId,
              message.requestId,
              message.callId,
              message.approved,
            );
            break;
          case "connectTrussGo":
            await trussGo.connect().catch((error: unknown) =>
              post({
                type: "error",
                message: error instanceof Error ? error.message : String(error),
              }),
            );
            break;
        }
      },
      undefined,
      context.subscriptions,
    );
  };

  context.subscriptions.push(
    output,
    vscode.window.registerWebviewViewProvider("trussHarness.chat", {
      resolveWebviewView: (webviewView) => {
        chat.attach(webviewView);
        bindWebview(webviewView.webview);
        webviewView.onDidDispose(
          () => {
            chat.detach(webviewView);
          },
          undefined,
          context.subscriptions,
        );
      },
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("trussHarness.openChat", () =>
      vscode.commands.executeCommand("workbench.view.extension.trussHarness"),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("trussHarness.connectTrussGo", () =>
      trussGo
        .connect()
        .catch((error: unknown) =>
          vscode.window.showErrorMessage(
            error instanceof Error ? error.message : String(error),
          ),
        ),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("trussHarness.checkForUpdates", () =>
      updates.check(true),
    ),
  );
  const providerCommands = new ProviderCommandController({
    accounts: providerAccounts,
    configuration: () => configuration,
    applyConfiguration: async (next) => {
      configuration = next;
      await context.workspaceState.update("modelConfiguration", configuration);
      chat.disposeService();
      await managedAgents.reset();
      post({ type: "runtimeReset" });
      await sendState();
    },
    resetRuntime: async () => {
      chat.disposeService();
      await managedAgents.reset();
    },
    showConnectionResult: showProviderConnectionResult,
  });
  context.subscriptions.push(...providerCommands.register());
  context.subscriptions.push(
    vscode.commands.registerCommand("trussHarness.generateCommitMessage", () =>
      gitCommit.generateAndApply(),
    ),
  );
  const workspaceCommands = new WorkspaceCommandController({
    workspaceRoot,
    output,
    post,
  });
  const inlineCompletion = new InlineCompletionController({
    configuration: () => configuration,
    service: startService,
    responses: inlineResponses,
  });
  context.subscriptions.push(
    ...workspaceCommands.register(),
    inlineCompletion.register(),
  );
  if (context.extensionMode === vscode.ExtensionMode.Production) {
    void updates.check(false);
  }
}

export function deactivate(): void {}
