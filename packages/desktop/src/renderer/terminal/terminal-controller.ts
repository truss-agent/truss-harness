import { previewServerUrlFromOutput } from "../../preview-url.js";
import type { DesktopBridge, DesktopGitStatus } from "../../shared.js";

const maxVisibleOutputCharacters = 50_000;
const maxPreviewOutputCharacters = 12_000;

export interface TerminalPromptState {
  readonly workspaceRoot: string;
  readonly gitStatus: DesktopGitStatus;
  readonly now: Date;
}

export interface TerminalPromptSegment {
  readonly className: string;
  readonly text: string;
}

export interface TerminalViewActions {
  readonly submit: (command: string) => void;
  readonly interrupt: () => void;
}

export interface DesktopTerminalView {
  bind(actions: TerminalViewActions): void;
  appendOutput(text: string, maximumCharacters: number): void;
  clearInput(): void;
  renderPrompt(segments: readonly TerminalPromptSegment[]): void;
}

export type DesktopTerminalClient = Pick<
  DesktopBridge,
  "runTerminal" | "stopTerminal"
>;

export interface DesktopTerminalCallbacks {
  readonly workspaceRoot: () => string;
  readonly gitStatus: () => DesktopGitStatus;
  readonly navigatePreview: (url: string) => void;
  readonly notify: (message: string) => void;
  readonly now?: () => Date;
}

export function terminalPromptSegments(
  state: TerminalPromptState,
): readonly TerminalPromptSegment[] {
  const workspaceParts = state.workspaceRoot
    .replaceAll("\\", "/")
    .split("/")
    .filter(Boolean);
  const path =
    workspaceParts.length > 3
      ? `…/${workspaceParts.slice(-3).join("/")}`
      : workspaceParts.join("/") || "No workspace";
  const branch = state.gitStatus.available
    ? state.gitStatus.branch || "detached"
    : "no git";
  const changed = state.gitStatus.files.length;
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(state.now);
  return [
    { className: "terminal-prompt-app", text: "Truss" },
    { className: "terminal-prompt-path", text: path },
    {
      className: "terminal-prompt-git",
      text: `${branch}${changed ? ` • ${changed} changed` : ""}`,
    },
    { className: "terminal-prompt-time", text: time },
  ];
}

/** Owns terminal commands, interruption, bounded output, preview detection, and prompt state. */
export class DesktopTerminalController {
  private readonly outputByCommand = new Map<string, string>();
  private readonly previewUrlByCommand = new Map<string, string>();
  private readonly actions: TerminalViewActions = {
    submit: (command) => void this.submit(command),
    interrupt: () => void this.interrupt(),
  };

  constructor(
    private readonly client: DesktopTerminalClient,
    private readonly view: DesktopTerminalView,
    private readonly callbacks: DesktopTerminalCallbacks,
  ) {}

  bind(): void {
    this.view.bind(this.actions);
  }

  append(text: string): void {
    this.view.appendOutput(text, maxVisibleOutputCharacters);
  }

  acceptOutput(commandId: string, text: string): void {
    this.append(text);
    const output = `${this.outputByCommand.get(commandId) ?? ""}${text}`.slice(
      -maxPreviewOutputCharacters,
    );
    this.outputByCommand.set(commandId, output);
    const url = previewServerUrlFromOutput(output);
    if (!url || this.previewUrlByCommand.get(commandId) === url) return;
    this.previewUrlByCommand.set(commandId, url);
    this.callbacks.navigatePreview(url);
    this.callbacks.notify(`Opened server preview: ${url}`);
  }

  renderPrompt(): void {
    this.view.renderPrompt(
      terminalPromptSegments({
        workspaceRoot: this.callbacks.workspaceRoot(),
        gitStatus: this.callbacks.gitStatus(),
        now: this.callbacks.now?.() ?? new Date(),
      }),
    );
  }

  private async submit(command: string): Promise<void> {
    const normalized = command.trim();
    if (!normalized) return;
    this.view.clearInput();
    this.append(`\n> ${normalized}\n`);
    try {
      await this.client.runTerminal(normalized);
    } catch (error) {
      this.callbacks.notify(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async interrupt(): Promise<void> {
    try {
      const stopped = await this.client.stopTerminal();
      if (!stopped) {
        this.callbacks.notify("No Truss terminal process is running.");
        return;
      }
      this.append(
        `^C\n[stopping ${stopped} terminal process${stopped === 1 ? "" : "es"}]\n`,
      );
    } catch (error) {
      this.callbacks.notify(
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
