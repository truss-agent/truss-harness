import { AgentHost } from "@truss-harness/agent-host";
import { brand } from "@truss-harness/branding";
import {
  FileAgentProfileStore,
  FileAgentRunHistoryStore,
  profileFromConfiguration,
} from "@truss-harness/cli/agents";
import type { ClientConfiguration } from "@truss-harness/cli/runtime";
import type { ModelProviderKind } from "@truss-harness/provider-openai-compatible";
import { AgentCoordinator, ApiKeyCredential } from "@truss-harness/runtime";
import * as vscode from "vscode";
import {
  dashboardApproval,
  dashboardProfile,
  dashboardRun,
} from "./agent-dashboard.js";
import type { AgentDashboardRequest, ModelConfiguration } from "./contracts.js";
import { agentControlCenterHtml } from "./webview-html.js";

export interface ManagedAgentControllerOptions {
  readonly context: vscode.ExtensionContext;
  readonly workspaceRoot: () => string;
  readonly configuration: () => ModelConfiguration;
  readonly providerApiKey: () => Promise<string | undefined>;
  readonly providerApiKeyForReference: (
    provider: ModelProviderKind,
    reference?: string,
  ) => Promise<string | undefined>;
}

export class ManagedAgentController implements vscode.Disposable {
  private coordinator: AgentCoordinator | undefined;
  private disposeEvents: (() => void) | undefined;
  private panel: vscode.WebviewPanel | undefined;
  private signature: string | undefined;

  constructor(private readonly options: ManagedAgentControllerOptions) {}

  registerCommands(): readonly vscode.Disposable[] {
    return [
      vscode.commands.registerCommand(
        "trussHarness.openAgentControlCenter",
        () =>
          this.open().catch((error: unknown) =>
            vscode.window.showErrorMessage(
              error instanceof Error ? error.message : String(error),
            ),
          ),
      ),
      vscode.commands.registerCommand("trussHarness.manageAgents", () =>
        this.manageProfiles(),
      ),
    ];
  }

  async reset(): Promise<void> {
    this.disposeEvents?.();
    this.disposeEvents = undefined;
    const current = this.coordinator;
    this.coordinator = undefined;
    this.signature = undefined;
    await current?.dispose();
  }

  dispose(): void {
    void this.reset();
  }

  private async open(): Promise<void> {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      await this.ensureCoordinator();
      await this.sendSnapshot();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "trussHarness.agentControlCenter",
      `${brand.productName}: Agent Control Center`,
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel = panel;
    panel.webview.html = agentControlCenterHtml(panel.webview);
    panel.onDidDispose(
      () => {
        if (this.panel === panel) this.panel = undefined;
      },
      undefined,
      this.options.context.subscriptions,
    );
    panel.webview.onDidReceiveMessage(
      (message: AgentDashboardRequest) => this.handleMessage(panel, message),
      undefined,
      this.options.context.subscriptions,
    );
  }

  private async handleMessage(
    panel: vscode.WebviewPanel,
    message: AgentDashboardRequest,
  ): Promise<void> {
    try {
      if (message.type === "ready") {
        await this.ensureCoordinator();
        await this.sendSnapshot();
        return;
      }
      if (message.type === "manageProfiles") {
        await this.manageProfiles();
        return;
      }
      const coordinator = await this.ensureCoordinator();
      if (message.type === "start") {
        if (!message.agentId?.trim() || !message.prompt?.trim()) {
          throw new Error("Choose an agent and enter a task.");
        }
        await coordinator.start({
          agentId: message.agentId,
          prompt: message.prompt,
        });
        await this.sendSnapshot();
        return;
      }
      if (message.type === "stop") {
        if (!message.runId?.trim()) {
          throw new Error("Choose an agent run to stop.");
        }
        await coordinator.stop(message.runId);
        await this.sendSnapshot();
        return;
      }
      if (message.type === "resolveApproval") {
        if (!message.runId?.trim() || !message.callId?.trim()) {
          throw new Error("The tool approval is incomplete.");
        }
        if (
          !(await coordinator.resolveApproval(
            message.runId,
            message.callId,
            message.approved,
          ))
        ) {
          throw new Error("That tool approval is no longer pending.");
        }
        await this.sendSnapshot();
      }
    } catch (error) {
      void panel.webview.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async manageProfiles(): Promise<void> {
    const configuration = this.options.configuration();
    if (!configuration.model) {
      throw new Error("Choose a model before managing agents.");
    }
    const store = new FileAgentProfileStore(this.options.workspaceRoot());
    const profiles = await store.list();
    const choice = await vscode.window.showQuickPick(
      [
        {
          label: "$(add) Create profile from current settings",
          action: "create" as const,
        },
        ...profiles.map((profile) => ({
          label: profile.displayName,
          description: `${profile.provider.providerId}/${profile.provider.modelId} · ${profile.mode}`,
          detail: profile.id,
          action: "show" as const,
        })),
      ],
      { placeHolder: "Manage workspace-local Truss agent profiles" },
    );
    if (!choice) return;
    if (choice.action === "create") {
      const name = await vscode.window.showInputBox({
        prompt: "Agent profile name",
        validateInput: (value) =>
          value.trim() ? undefined : "A name is required.",
      });
      if (!name?.trim()) return;
      const runtime: ClientConfiguration = {
        workspaceRoot: this.options.workspaceRoot(),
        provider: configuration.provider,
        baseUrl: configuration.baseUrl,
        model: configuration.model,
        credentialRef: configuration.credentialAccountId,
        apiKey: await this.options.providerApiKey(),
        mode: configuration.mode,
        internetAccess: configuration.internetAccess,
        mcpServers: configuration.mcpServers,
      };
      const profile = await store.create(
        profileFromConfiguration(runtime, name),
      );
      await vscode.window.showInformationMessage(
        `${brand.productName} created agent profile ${profile.displayName}.`,
      );
    }
    await this.open();
  }

  private async sendSnapshot(): Promise<void> {
    if (!this.panel || !this.coordinator) return;
    const profiles = await this.coordinator.listProfiles();
    void this.panel.webview.postMessage({
      type: "state",
      profiles: profiles.map(dashboardProfile),
      runs: this.coordinator.listRuns().map(dashboardRun),
    });
  }

  private async ensureCoordinator(): Promise<AgentCoordinator> {
    const configuration = this.options.configuration();
    if (!configuration.model) {
      throw new Error("Choose a model before starting a managed agent.");
    }
    const credential = await this.options.providerApiKey();
    const signature = JSON.stringify({
      workspaceRoot: this.options.workspaceRoot(),
      provider: configuration.provider,
      credentialAccountId: configuration.credentialAccountId,
      baseUrl: configuration.baseUrl,
      model: configuration.model,
      internetAccess: configuration.internetAccess,
      mcpServers: configuration.mcpServers,
      hasCredential: Boolean(credential),
    });
    if (this.coordinator && this.signature === signature)
      return this.coordinator;
    await this.reset();
    const host = new AgentHost({
      workspaceRoot: this.options.workspaceRoot(),
      mcpServers: configuration.mcpServers,
      credentialResolver: {
        resolve: async (reference, binding) => {
          const accountReference =
            reference === "configuration"
              ? configuration.credentialAccountId
              : reference;
          const value =
            reference === "configuration" && credential
              ? credential
              : await this.options.providerApiKeyForReference(
                  binding.providerId as ModelProviderKind,
                  accountReference,
                );
          return value
            ? new ApiKeyCredential(`vscode-agent-${reference}`, value)
            : undefined;
        },
      },
      approvalFactory: dashboardApproval,
    });
    const coordinator = new AgentCoordinator({
      profiles: new FileAgentProfileStore(this.options.workspaceRoot()),
      runtimeFactory: host.createRuntimeFactory(),
      history: new FileAgentRunHistoryStore(this.options.workspaceRoot()),
    });
    await coordinator.restoreHistory();
    this.coordinator = coordinator;
    this.signature = signature;
    this.disposeEvents = coordinator.events.subscribe((event) => {
      if (event.type === "run_updated") {
        void this.panel?.webview.postMessage({
          type: "run",
          run: dashboardRun(event.run),
        });
      }
      if (
        event.type === "runtime" &&
        event.event.event.type === "tool_call_requested"
      ) {
        void this.panel?.webview.postMessage({
          type: "approval",
          runId: event.event.runId,
          callId: event.event.event.callId,
          tool: event.event.event.tool,
          input: event.event.event.input,
        });
      }
    });
    return coordinator;
  }
}
