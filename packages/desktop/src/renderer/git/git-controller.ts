import type {
  DesktopBridge,
  DesktopGitFile,
  DesktopGitGraph,
  DesktopGitStatus,
} from "../../shared.js";

export interface GitConfirmation {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
  readonly danger: boolean;
}

export interface GitViewSnapshot {
  readonly collapsed: boolean;
  readonly status: DesktopGitStatus;
  readonly graph: DesktopGitGraph;
}

export interface GitViewActions {
  readonly refresh: () => void;
  readonly toggleCollapsed: () => void;
  readonly stageAll: () => void;
  readonly discardAll: () => void;
  readonly pull: () => void;
  readonly push: () => void;
  readonly generateCommitMessage: () => void;
  readonly commit: (message: string) => void;
  readonly stageFile: (path: string) => void;
  readonly unstageFile: (path: string) => void;
  readonly discardFile: (path: string) => void;
}

export interface DesktopGitView {
  bind(actions: GitViewActions): void;
  render(snapshot: GitViewSnapshot, actions: GitViewActions): void;
  setCommitMessage(message: string): void;
  focusCommitMessage(): void;
  setGeneratingCommitMessage(generating: boolean): void;
}

export type DesktopGitClient = Pick<
  DesktopBridge,
  | "gitStatus"
  | "gitGraph"
  | "gitStage"
  | "gitUnstage"
  | "gitDiscard"
  | "gitGenerateCommitMessage"
  | "gitCommit"
  | "gitPull"
  | "gitPush"
>;

export interface DesktopGitCallbacks {
  readonly collapsed: () => boolean;
  readonly toggleCollapsed: () => void;
  readonly hasConfiguredModel: () => boolean;
  readonly openSettings: () => void;
  readonly requestConfirmation: (
    confirmation: GitConfirmation,
  ) => Promise<boolean>;
  readonly appendTerminal: (text: string) => void;
  readonly notify: (message: string) => void;
  readonly refreshFiles: () => Promise<void>;
  readonly renderTerminalPrompt: () => void;
}

const unavailableStatus: DesktopGitStatus = {
  available: false,
  ahead: 0,
  behind: 0,
  files: [],
};

const unavailableGraph: DesktopGitGraph = { available: false, commits: [] };

export function stagedGitFiles(
  status: DesktopGitStatus,
): readonly DesktopGitFile[] {
  return status.files.filter(
    (file) => file.indexStatus !== " " && file.indexStatus !== "?",
  );
}

export function gitStatusSummary(status: DesktopGitStatus): string {
  const staged = stagedGitFiles(status);
  return [
    status.ahead ? `up ${status.ahead}` : "",
    status.behind ? `down ${status.behind}` : "",
    `${status.files.length} changed`,
    staged.length ? `${staged.length} staged` : "commit will stage changes",
    status.pushRemote ? `remote ${status.pushRemote}` : "no push remote",
  ]
    .filter(Boolean)
    .join(" | ");
}

/** Owns Desktop Git state, actions, refresh ordering, and user feedback. */
export class DesktopGitController {
  private statusValue: DesktopGitStatus = unavailableStatus;
  private graphValue: DesktopGitGraph = unavailableGraph;

  private readonly actions: GitViewActions = {
    refresh: () => void this.refresh(),
    toggleCollapsed: () => this.callbacks.toggleCollapsed(),
    stageAll: () => void this.stageAll(),
    discardAll: () => void this.discardAll(),
    pull: () => void this.runAction("pull", () => this.client.gitPull()),
    push: () => void this.push(),
    generateCommitMessage: () => void this.generateCommitMessage(),
    commit: (message) => void this.commit(message),
    stageFile: (path) =>
      void this.runAction("stage", () => this.client.gitStage([path])),
    unstageFile: (path) =>
      void this.runAction("unstage", () => this.client.gitUnstage([path])),
    discardFile: (path) => void this.discardFile(path),
  };

  constructor(
    private readonly client: DesktopGitClient,
    private readonly view: DesktopGitView,
    private readonly callbacks: DesktopGitCallbacks,
  ) {}

  get status(): DesktopGitStatus {
    return this.statusValue;
  }

  get graph(): DesktopGitGraph {
    return this.graphValue;
  }

  bind(): void {
    this.view.bind(this.actions);
  }

  render(): void {
    this.view.render(
      {
        collapsed: this.callbacks.collapsed(),
        status: this.statusValue,
        graph: this.graphValue,
      },
      this.actions,
    );
  }

  async refresh(): Promise<void> {
    [this.statusValue, this.graphValue] = await Promise.all([
      this.client.gitStatus(),
      this.client.gitGraph(),
    ]);
    this.render();
    this.callbacks.renderTerminalPrompt();
  }

  private async stageAll(): Promise<void> {
    const staged = stagedGitFiles(this.statusValue);
    if (staged.length) {
      await this.runAction("unstage", () =>
        this.client.gitUnstage(staged.map((file) => file.path)),
      );
      return;
    }
    if (!this.statusValue.files.length) {
      this.callbacks.notify("No changed files to stage.");
      return;
    }
    await this.runAction("stage", () =>
      this.client.gitStage(this.statusValue.files.map((file) => file.path)),
    );
  }

  private async discardAll(): Promise<void> {
    if (!this.statusValue.files.length) {
      this.callbacks.notify("No uncommitted changes to discard.");
      return;
    }
    const confirmed = await this.callbacks.requestConfirmation({
      title: "Discard workspace changes",
      message:
        "Discard every uncommitted change in this workspace? This also removes untracked files and cannot be undone.",
      confirmLabel: "Discard all",
      danger: true,
    });
    if (!confirmed) return;
    await this.runAction("discard all", () =>
      this.client.gitDiscard(this.statusValue.files.map((file) => file.path)),
    );
  }

  private async discardFile(path: string): Promise<void> {
    const confirmed = await this.callbacks.requestConfirmation({
      title: "Discard file changes",
      message: `Discard all uncommitted changes in ${path}? This cannot be undone.`,
      confirmLabel: "Discard",
      danger: true,
    });
    if (confirmed)
      await this.runAction("discard", () => this.client.gitDiscard([path]));
  }

  private async push(): Promise<void> {
    if (!this.statusValue.pushRemote) {
      this.callbacks.notify(
        "No push remote configured. Add one with: git remote add origin <url>",
      );
      return;
    }
    await this.runAction("push", () => this.client.gitPush());
  }

  private async generateCommitMessage(): Promise<void> {
    if (!this.callbacks.hasConfiguredModel()) {
      this.callbacks.openSettings();
      this.callbacks.notify("Choose a local model first.");
      return;
    }
    this.view.setGeneratingCommitMessage(true);
    try {
      const message = await this.client.gitGenerateCommitMessage();
      this.view.setCommitMessage(message);
      this.view.focusCommitMessage();
      this.callbacks.notify(
        "Commit message generated. Review it, then commit.",
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.callbacks.appendTerminal(
        `\n[commit message generation failed] ${detail}\n`,
      );
      this.callbacks.notify(detail);
    } finally {
      this.view.setGeneratingCommitMessage(false);
    }
  }

  private async commit(message: string): Promise<void> {
    const normalized = message.trim();
    if (!normalized) {
      this.callbacks.notify("Enter a commit message.");
      return;
    }
    await this.runAction("commit", async () => {
      const output = await this.client.gitCommit(normalized);
      this.view.setCommitMessage("");
      return output;
    });
  }

  private async runAction(
    action: string,
    run: () => Promise<string>,
  ): Promise<void> {
    try {
      const result = await run();
      this.callbacks.appendTerminal(`\n[git ${action}]\n${result}\n`);
      this.callbacks.notify(`Git ${action} complete.`);
      await Promise.all([this.refresh(), this.callbacks.refreshFiles()]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.callbacks.appendTerminal(`\n[git ${action} failed]\n${message}\n`);
      this.callbacks.notify(`Git ${action} failed: ${message}`);
    }
  }
}
