import { describe, expect, it, vi } from "vitest";
import type { DesktopGitStatus } from "../../shared.js";
import {
  type DesktopTerminalCallbacks,
  type DesktopTerminalClient,
  DesktopTerminalController,
  type DesktopTerminalView,
  type TerminalPromptSegment,
  type TerminalViewActions,
  terminalPromptSegments,
} from "./terminal-controller.js";

const gitStatus: DesktopGitStatus = {
  available: true,
  branch: "feature",
  ahead: 1,
  behind: 0,
  files: [{ path: "src/index.ts", indexStatus: " ", workTreeStatus: "M" }],
  pushRemote: "origin",
};

class TestTerminalView implements DesktopTerminalView {
  actions: TerminalViewActions | undefined;
  output = "";
  inputCleared = false;
  maximumCharacters = 0;
  prompt: readonly TerminalPromptSegment[] = [];

  bind(actions: TerminalViewActions): void {
    this.actions = actions;
  }

  appendOutput(text: string, maximumCharacters: number): void {
    this.output = `${this.output}${text}`.slice(-maximumCharacters);
    this.maximumCharacters = maximumCharacters;
  }

  clearInput(): void {
    this.inputCleared = true;
  }

  renderPrompt(segments: readonly TerminalPromptSegment[]): void {
    this.prompt = segments;
  }
}

function setup(options: { readonly stopped?: number } = {}) {
  const client: DesktopTerminalClient = {
    runTerminal: vi.fn(async () => "command-1"),
    stopTerminal: vi.fn(async () => options.stopped ?? 1),
  };
  const view = new TestTerminalView();
  const callbacks: DesktopTerminalCallbacks = {
    workspaceRoot: () => "/home/truss/workspace",
    gitStatus: () => gitStatus,
    navigatePreview: vi.fn(),
    notify: vi.fn(),
    now: () => new Date("2026-08-13T10:20:30.000Z"),
  };
  const controller = new DesktopTerminalController(client, view, callbacks);
  controller.bind();
  return { client, view, callbacks, controller };
}

describe("DesktopTerminalController", () => {
  it("normalizes, echoes, and runs submitted commands", async () => {
    const { client, view } = setup();

    view.actions?.submit("  npm test  ");

    await vi.waitFor(() =>
      expect(client.runTerminal).toHaveBeenCalledWith("npm test"),
    );
    expect(view.inputCleared).toBe(true);
    expect(view.output).toContain("\n> npm test\n");
    expect(view.maximumCharacters).toBe(50_000);
  });

  it("ignores empty commands", async () => {
    const { client, view } = setup();
    view.actions?.submit("   ");

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.runTerminal).not.toHaveBeenCalled();
    expect(view.inputCleared).toBe(false);
  });

  it("interrupts managed processes and reports the count", async () => {
    const { client, view } = setup({ stopped: 2 });
    view.actions?.interrupt();

    await vi.waitFor(() => expect(client.stopTerminal).toHaveBeenCalledOnce());
    expect(view.output).toContain("^C\n[stopping 2 terminal processes]\n");
  });

  it("reports an idle interrupt without writing fake process output", async () => {
    const { view, callbacks } = setup({ stopped: 0 });
    view.actions?.interrupt();

    await vi.waitFor(() =>
      expect(callbacks.notify).toHaveBeenCalledWith(
        "No Truss terminal process is running.",
      ),
    );
    expect(view.output).toBe("");
  });

  it("opens each announced preview URL once per command", () => {
    const { controller, callbacks } = setup();

    controller.acceptOutput("dev-1", "Local: http://localhost:5173/\n");
    controller.acceptOutput("dev-1", "Local: http://localhost:5173/\n");

    expect(callbacks.navigatePreview).toHaveBeenCalledOnce();
    expect(callbacks.navigatePreview).toHaveBeenCalledWith(
      "http://localhost:5173/",
    );
    expect(callbacks.notify).toHaveBeenCalledWith(
      "Opened server preview: http://localhost:5173/",
    );
  });

  it("renders prompt state through the view", () => {
    const { controller, view } = setup();

    controller.renderPrompt();

    expect(view.prompt.map((segment) => segment.text)).toEqual([
      "Truss",
      "home/truss/workspace",
      "feature • 1 changed",
      expect.any(String),
    ]);
  });
});

describe("terminalPromptSegments", () => {
  it("shortens deep paths and projects detached or unavailable repositories", () => {
    const segments = terminalPromptSegments({
      workspaceRoot: "/home/person/Work/truss-harness",
      gitStatus: {
        available: false,
        ahead: 0,
        behind: 0,
        files: [],
      },
      now: new Date("2026-08-13T10:20:30.000Z"),
    });

    expect(segments.slice(0, 3).map((segment) => segment.text)).toEqual([
      "Truss",
      "…/person/Work/truss-harness",
      "no git",
    ]);
  });
});
