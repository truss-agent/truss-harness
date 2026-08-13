import { describe, expect, it, vi } from "vitest";
import type { DesktopGitGraph, DesktopGitStatus } from "../../shared.js";
import {
  type DesktopGitCallbacks,
  type DesktopGitClient,
  DesktopGitController,
  type DesktopGitView,
  type GitViewActions,
  type GitViewSnapshot,
  gitStatusSummary,
  stagedGitFiles,
} from "./git-controller.js";

const cleanStatus: DesktopGitStatus = {
  available: true,
  branch: "master",
  ahead: 0,
  behind: 0,
  files: [],
  pushRemote: "origin",
};

const graph: DesktopGitGraph = { available: true, commits: [] };

class TestGitView implements DesktopGitView {
  actions: GitViewActions | undefined;
  snapshot: GitViewSnapshot | undefined;
  commitMessage = "";
  generating = false;
  focused = false;

  bind(actions: GitViewActions): void {
    this.actions = actions;
  }

  render(snapshot: GitViewSnapshot): void {
    this.snapshot = snapshot;
  }

  setCommitMessage(message: string): void {
    this.commitMessage = message;
  }

  focusCommitMessage(): void {
    this.focused = true;
  }

  setGeneratingCommitMessage(generating: boolean): void {
    this.generating = generating;
  }
}

function setup(status: DesktopGitStatus = cleanStatus) {
  const client: DesktopGitClient = {
    gitStatus: vi.fn(async () => status),
    gitGraph: vi.fn(async () => graph),
    gitStage: vi.fn(async () => "staged"),
    gitUnstage: vi.fn(async () => "unstaged"),
    gitDiscard: vi.fn(async () => "discarded"),
    gitGenerateCommitMessage: vi.fn(async () => "feat: generated"),
    gitCommit: vi.fn(async () => "committed"),
    gitPull: vi.fn(async () => "pulled"),
    gitPush: vi.fn(async () => "pushed"),
  };
  const view = new TestGitView();
  const callbacks: DesktopGitCallbacks = {
    collapsed: () => false,
    toggleCollapsed: vi.fn(),
    hasConfiguredModel: () => true,
    openSettings: vi.fn(),
    requestConfirmation: vi.fn(async () => true),
    appendTerminal: vi.fn(),
    notify: vi.fn(),
    refreshFiles: vi.fn(async () => undefined),
    renderTerminalPrompt: vi.fn(),
  };
  const controller = new DesktopGitController(client, view, callbacks);
  controller.bind();
  return { client, view, callbacks, controller };
}

describe("DesktopGitController", () => {
  it("owns status and graph refresh rendering", async () => {
    const status = {
      ...cleanStatus,
      ahead: 2,
      files: [{ path: "src/index.ts", indexStatus: " ", workTreeStatus: "M" }],
    };
    const { controller, view, callbacks } = setup(status);

    await controller.refresh();

    expect(controller.status).toEqual(status);
    expect(view.snapshot).toEqual({ collapsed: false, status, graph });
    expect(callbacks.renderTerminalPrompt).toHaveBeenCalledOnce();
  });

  it("stages all changes and refreshes Git and Files after success", async () => {
    const status = {
      ...cleanStatus,
      files: [
        { path: "src/index.ts", indexStatus: " ", workTreeStatus: "M" },
        { path: "README.md", indexStatus: "?", workTreeStatus: "?" },
      ],
    };
    const { controller, client, view, callbacks } = setup(status);
    await controller.refresh();

    view.actions?.stageAll();

    await vi.waitFor(() =>
      expect(client.gitStage).toHaveBeenCalledWith([
        "src/index.ts",
        "README.md",
      ]),
    );
    expect(callbacks.refreshFiles).toHaveBeenCalledOnce();
    expect(callbacks.appendTerminal).toHaveBeenCalledWith(
      "\n[git stage]\nstaged\n",
    );
  });

  it("unstages existing staged files instead of staging everything", async () => {
    const status = {
      ...cleanStatus,
      files: [
        { path: "staged.ts", indexStatus: "M", workTreeStatus: " " },
        { path: "working.ts", indexStatus: " ", workTreeStatus: "M" },
      ],
    };
    const { controller, client, view } = setup(status);
    await controller.refresh();

    view.actions?.stageAll();

    await vi.waitFor(() =>
      expect(client.gitUnstage).toHaveBeenCalledWith(["staged.ts"]),
    );
    expect(client.gitStage).not.toHaveBeenCalled();
  });

  it("confirms destructive file actions before discarding", async () => {
    const { view, client, callbacks } = setup({
      ...cleanStatus,
      files: [{ path: "src/index.ts", indexStatus: " ", workTreeStatus: "M" }],
    });
    const controller = new DesktopGitController(client, view, callbacks);
    controller.bind();
    await controller.refresh();

    view.actions?.discardFile("src/index.ts");

    await vi.waitFor(() =>
      expect(client.gitDiscard).toHaveBeenCalledWith(["src/index.ts"]),
    );
    expect(callbacks.requestConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Discard file changes",
        danger: true,
      }),
    );
  });

  it("generates and focuses a commit message while restoring button state", async () => {
    const { controller, view, callbacks } = setup();
    controller.bind();

    view.actions?.generateCommitMessage();

    expect(view.generating).toBe(true);
    await vi.waitFor(() => expect(view.commitMessage).toBe("feat: generated"));
    expect(view.focused).toBe(true);
    expect(view.generating).toBe(false);
    expect(callbacks.notify).toHaveBeenCalledWith(
      "Commit message generated. Review it, then commit.",
    );
  });

  it("does not push without a configured remote", async () => {
    const { controller, view, client, callbacks } = setup({
      ...cleanStatus,
      pushRemote: undefined,
    });
    await controller.refresh();

    view.actions?.push();

    await vi.waitFor(() =>
      expect(callbacks.notify).toHaveBeenCalledWith(
        "No push remote configured. Add one with: git remote add origin <url>",
      ),
    );
    expect(client.gitPush).not.toHaveBeenCalled();
  });
});

describe("Git status projection", () => {
  it("selects staged files and summarizes repository state", () => {
    const status: DesktopGitStatus = {
      ...cleanStatus,
      ahead: 1,
      behind: 2,
      files: [
        { path: "staged.ts", indexStatus: "M", workTreeStatus: " " },
        { path: "working.ts", indexStatus: " ", workTreeStatus: "M" },
      ],
    };

    expect(stagedGitFiles(status).map((file) => file.path)).toEqual([
      "staged.ts",
    ]);
    expect(gitStatusSummary(status)).toBe(
      "up 1 | down 2 | 2 changed | 1 staged | remote origin",
    );
  });
});
