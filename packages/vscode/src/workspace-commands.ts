import { executeWorkspaceCommand } from "@truss-harness/runtime";
import * as vscode from "vscode";

export interface WorkspaceCommandControllerOptions {
  readonly workspaceRoot: () => string;
  readonly output: vscode.OutputChannel;
  readonly post: (message: unknown) => void;
}

export class WorkspaceCommandController {
  constructor(private readonly options: WorkspaceCommandControllerOptions) {}

  register(): readonly vscode.Disposable[] {
    return [
      vscode.commands.registerCommand("trussHarness.initializeWorkspace", () =>
        this.run("/init"),
      ),
      vscode.commands.registerCommand(
        "trussHarness.updateWorkspaceMemory",
        () => this.run("/update"),
      ),
      vscode.commands.registerCommand("trussHarness.showWorkspaceStatus", () =>
        this.run("/status"),
      ),
      vscode.commands.registerCommand("trussHarness.clearWorkspaceMemory", () =>
        this.run("/clear-memory"),
      ),
    ];
  }

  private async run(input: string): Promise<void> {
    const result = await executeWorkspaceCommand({
      workspaceRoot: this.options.workspaceRoot(),
      input,
    });
    this.options.output.appendLine(result.message);
    this.options.post({
      type: "workspaceCommand",
      command: input,
      message: result.message,
    });
    const summary = result.message.split("\n")[0];
    if (result.ok) void vscode.window.showInformationMessage(summary);
    else void vscode.window.showErrorMessage(summary);
  }
}
