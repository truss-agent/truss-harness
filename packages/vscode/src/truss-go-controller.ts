import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { createPairingUri, detectLanAddress } from "@truss-harness/gateway";
import QRCode from "qrcode";
import * as vscode from "vscode";
import type { ModelConfiguration } from "./contracts.js";

export interface TrussGoControllerOptions {
  readonly context: vscode.ExtensionContext;
  readonly configuration: () => ModelConfiguration;
  readonly runtimeEnvironment: () => Promise<NodeJS.ProcessEnv>;
  readonly workspaceRoot: () => string;
}

export class TrussGoController implements vscode.Disposable {
  private process: ChildProcessWithoutNullStreams | undefined;

  constructor(private readonly options: TrussGoControllerOptions) {}

  async connect(): Promise<void> {
    const configuration = this.options.configuration();
    if (!configuration.model) {
      throw new Error("Choose a model before connecting Truss Go.");
    }
    const address = detectLanAddress();
    if (!address) {
      throw new Error(
        "Could not find a private Wi-Fi address for this computer.",
      );
    }
    this.stop();
    const { context } = this.options;
    const configuredCommand = vscode.workspace
      .getConfiguration("trussHarness")
      .get<string>("command", "")
      .trim();
    const developmentCli = resolve(context.extensionPath, "../cli/dist/bin.js");
    const bundledCli = resolve(context.extensionPath, "dist/truss-service.cjs");
    const command = configuredCommand || process.execPath;
    const commandArguments = configuredCommand
      ? []
      : context.extensionMode === vscode.ExtensionMode.Development
        ? [developmentCli]
        : [bundledCli];
    const token = randomBytes(32).toString("hex");
    this.process = spawn(
      command,
      [
        ...commandArguments,
        "gateway",
        "--gateway-host",
        address,
        "--gateway-port",
        "4787",
        "--gateway-token",
        token,
      ],
      {
        cwd: this.options.workspaceRoot(),
        windowsHide: true,
        env: {
          ...(await this.options.runtimeEnvironment()),
          ...(configuredCommand ? {} : { ELECTRON_RUN_AS_NODE: "1" }),
        },
      },
    );
    await this.waitUntilReady().catch((error) => {
      this.stop();
      throw error;
    });
    const pairingUri = createPairingUri({
      gatewayUrl: `http://${address}:4787`,
      token,
      workspaceName: vscode.workspace.name ?? "Workspace",
    });
    const qrDataUrl = await QRCode.toDataURL(pairingUri, {
      margin: 2,
      width: 320,
    });
    const panel = vscode.window.createWebviewPanel(
      "trussHarnessGo",
      "Connect Truss Go",
      vscode.ViewColumn.Beside,
      { enableScripts: true },
    );
    panel.webview.html = `<!doctype html><body style="font-family:system-ui;text-align:center;padding:24px"><h2>Connect Truss Go</h2><p>Scan in the Truss Go app on the same Wi-Fi.</p><img style="width:320px;max-width:100%" src="${qrDataUrl}"><p>${vscode.workspace.name ?? "Workspace"}</p><button id="disconnect">Disconnect</button><script>const v=acquireVsCodeApi();document.querySelector('#disconnect').onclick=()=>v.postMessage('disconnect')</script></body>`;
    panel.webview.onDidReceiveMessage(
      (message) => {
        if (message === "disconnect") {
          this.stop();
          panel.dispose();
        }
      },
      undefined,
      context.subscriptions,
    );
    panel.onDidDispose(() => this.stop(), undefined, context.subscriptions);
  }

  dispose(): void {
    this.stop();
  }

  private stop(): void {
    this.process?.kill();
    this.process = undefined;
  }

  private waitUntilReady(): Promise<void> {
    return new Promise<void>((resolveReady, rejectReady) => {
      const child = this.process;
      if (!child)
        return rejectReady(new Error("Truss Go gateway did not start."));
      const timeout = setTimeout(
        () => rejectReady(new Error("Truss Go gateway did not start in time.")),
        8_000,
      );
      child.once("error", (error) => {
        clearTimeout(timeout);
        rejectReady(error);
      });
      child.once("exit", (code) => {
        clearTimeout(timeout);
        rejectReady(
          new Error(`Truss Go gateway exited (${code ?? "unknown"}).`),
        );
      });
      child.stdout.on("data", (data: Buffer) => {
        if (data.toString().includes("mobile gateway listening")) {
          clearTimeout(timeout);
          resolveReady();
        }
      });
    });
  }
}
