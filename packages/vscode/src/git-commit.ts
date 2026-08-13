import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { brand } from "@truss-harness/branding";
import * as vscode from "vscode";
import type { InlineResponseBuffer } from "./inline-responses.js";
import type { RuntimeService } from "./runtime-service.js";

const execFile = promisify(execFileCallback);

interface GitRepository {
  readonly rootUri: vscode.Uri;
  readonly inputBox: { value: string };
}

interface GitApi {
  readonly repositories: readonly GitRepository[];
}

interface GitExtension {
  getAPI(version: 1): GitApi;
}

function normalizeCommitMessage(value: string): string {
  return value
    .trim()
    .replace(/^```(?:gitcommit|text|markdown)?\s*/i, "")
    .replace(/\s*```$/, "")
    .replace(/^(?:commit message|message):\s*/i, "")
    .trim();
}

export class GitCommitController {
  constructor(
    private readonly root: () => string,
    private readonly service: () => Promise<RuntimeService>,
    private readonly responses: InlineResponseBuffer,
    private readonly output: vscode.OutputChannel,
  ) {}

  async generateAndApply(): Promise<void> {
    try {
      const message = await this.generate();
      if (await this.setCommitMessage(message)) {
        void vscode.window.showInformationMessage(
          `${brand.productName} filled the Git commit-message input.`,
        );
      } else {
        await vscode.env.clipboard.writeText(message);
        void vscode.window.showInformationMessage(
          `${brand.productName} copied the commit message to the clipboard.`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`Commit message generation failed: ${message}`);
      void vscode.window.showErrorMessage(`${brand.productName}: ${message}`);
    }
  }

  private async workingDiff(): Promise<string> {
    let diff = (
      await execFile("git", ["diff", "--cached", "--no-ext-diff"], {
        cwd: this.root(),
        maxBuffer: 1_000_000,
      })
    ).stdout;
    if (!diff.trim()) {
      diff = (
        await execFile("git", ["diff", "--no-ext-diff"], {
          cwd: this.root(),
          maxBuffer: 1_000_000,
        })
      ).stdout;
    }
    if (!diff.trim()) {
      throw new Error("There are no staged or unstaged changes to summarize.");
    }
    return diff;
  }

  private async generate(): Promise<string> {
    const diff = await this.workingDiff();
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.SourceControl,
        title: `${brand.productName}: Generating commit message`,
        cancellable: true,
      },
      async (_progress, cancellationToken) => {
        const current = await this.service();
        const run =
          current.run(`You write accurate, production-quality Git commit messages. Analyze the diff and return only one Conventional Commit message.

Requirements:
- First line format: type(optional scope): imperative summary
- Choose the most accurate type from feat, fix, refactor, perf, docs, test, build, ci, or chore.
- Keep the subject under 72 characters and describe the actual user-visible or technical change.
- Use specific verbs and nouns. Do not use vague wording such as "update", "changes", or "stuff".
- Add a blank line and a concise body only when it clarifies important behavior, constraints, or follow-up effects.
- Do not include Markdown, quotes, explanations, issue numbers, or text such as "Commit message:".

Diff:
${diff}`);
        this.responses.begin(run.requestId);
        const cancellation = cancellationToken.onCancellationRequested(() =>
          current.abort(run.requestId),
        );
        try {
          await run.result;
          const message = normalizeCommitMessage(
            this.responses.value(run.requestId) ?? "",
          );
          if (!message)
            throw new Error("The model returned an empty commit message.");
          return message;
        } finally {
          cancellation.dispose();
          this.responses.end(run.requestId);
        }
      },
    );
  }

  private async setCommitMessage(message: string): Promise<boolean> {
    const gitExtension =
      vscode.extensions.getExtension<GitExtension>("vscode.git");
    if (!gitExtension) return false;
    if (!gitExtension.isActive) await gitExtension.activate();
    const api = gitExtension.exports.getAPI(1);
    const repository =
      api.repositories.find((item) => item.rootUri.fsPath === this.root()) ??
      api.repositories[0];
    if (!repository) return false;
    repository.inputBox.value = message;
    return true;
  }
}
