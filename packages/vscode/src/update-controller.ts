import { brand } from "@truss-harness/branding";
import * as vscode from "vscode";
import {
  availableVsCodeUpdate,
  type VsCodeRelease,
} from "./extension-updates.js";

const releasesApi =
  "https://api.github.com/repos/truss-agent/truss-harness/releases?per_page=30";
const automaticCheckInterval = 24 * 60 * 60 * 1_000;

export class UpdateController {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
  ) {}

  async check(interactive: boolean): Promise<void> {
    const now = Date.now();
    const lastCheck = this.context.globalState.get<number>(
      "lastUpdateCheck",
      0,
    );
    if (!interactive && now - lastCheck < automaticCheckInterval) return;
    await this.context.globalState.update("lastUpdateCheck", now);
    try {
      const response = await fetch(releasesApi, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "truss-harness-vscode",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
      if (!response.ok) throw new Error(`GitHub returned ${response.status}.`);
      const releases = (await response.json()) as VsCodeRelease[];
      const currentVersion = String(
        this.context.extension.packageJSON.version ?? "0.0.0",
      );
      const update = availableVsCodeUpdate(currentVersion, releases);
      if (!update) {
        if (interactive) {
          await vscode.window.showInformationMessage(
            `${brand.productName} for VS Code ${currentVersion} is up to date.`,
          );
        }
        return;
      }
      const lastNotified = this.context.globalState.get<string>(
        "lastNotifiedVersion",
      );
      if (!interactive && lastNotified === update.version) return;
      await this.context.globalState.update(
        "lastNotifiedVersion",
        update.version,
      );
      const action = await vscode.window.showInformationMessage(
        `${brand.productName} for VS Code ${update.version} is available. Download the signed VSIX, then use Extensions: Install from VSIX to update.`,
        "Download VSIX",
        "View release",
      );
      const target =
        action === "Download VSIX"
          ? update.downloadUrl
          : action === "View release"
            ? update.releaseUrl
            : undefined;
      if (target) await vscode.env.openExternal(vscode.Uri.parse(target));
    } catch (error) {
      this.output.appendLine(
        `[updates] ${error instanceof Error ? error.message : String(error)}`,
      );
      if (interactive) {
        await vscode.window.showWarningMessage(
          `${brand.productName} could not check for updates. See the Truss output for details.`,
        );
      }
    }
  }
}
