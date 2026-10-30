import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  type ChatAttachment,
  executeWorkspaceCommand,
  NodeProcessRunner,
  type ProcessRunner,
  type ProcessRunResult,
  type RuntimeEvent,
  type SkillMode,
  type SkillSelection,
  type ToolCall,
  type WorkspacePlan,
} from "@truss-harness/runtime";
import { FileAgentProfileStore } from "../agents.js";
import type { ResolvedConfiguration } from "../config.js";
import type { PermissionMode } from "../protocol.js";
import type { ClientConfiguration, ClientRuntime } from "../runtime.js";
import { skillServiceHost } from "../skills.js";
import { type AgentStatusReporter, silentAgentStatus } from "./agent-status.js";
import {
  approvalPreview,
  resolvePath,
  SwitchableApproval,
} from "./approval.js";
import {
  type ApprovalRule,
  type ApprovalRuleStore,
  type ApprovalScope,
  describeRule,
  FileApprovalRuleStore,
  matchesRule,
  ruleFor,
  sameRule,
  validRules,
} from "./approval-rules.js";
import {
  type ImageData,
  imagePathFromText,
  readImageFile,
} from "./clipboard.js";
import { interactiveCommands, parseInput } from "./commands.js";
import {
  type ComposerState,
  emptyComposer,
  menuCommands,
  reduceComposer,
} from "./composer.js";
import {
  type ConversationStore,
  conversationTitle,
  newConversationId,
  repairForResume,
} from "./conversations.js";
import { InputDecoder, type KeyEvent } from "./input.js";
import {
  openPicker,
  type PickerItem,
  type PickerState,
  reducePicker,
  renderPicker,
} from "./picker.js";
import {
  formatHelp,
  formatToolCall,
  formatToolSummary,
  formatToolResult,
  formatUserMessage,
  renderComposer,
  type Style,
} from "./renderer.js";
import {
  diffRows,
  editedContent,
  editSummary,
  formatCode,
  formatDiff,
} from "./code-preview.js";
import { MarkdownRenderer } from "./markdown.js";
import { inlineMath, mathFenceRenderer } from "./math.js";
import { mermaidFenceRenderer } from "./mermaid.js";
import { LiveScreen } from "./terminal.js";
import { sanitize, truncate } from "./text.js";

type AgentMode = "chat" | "plan" | "edit";
const modes: readonly AgentMode[] = ["chat", "plan", "edit"];
const permissions: readonly PermissionMode[] = ["ask", "auto-read", "auto-all"];
const shellTimeoutMilliseconds = 10 * 60_000;
const shellOutputBytes = 256 * 1024;
/** Output of one ! command sent to the model; the rest stays on screen. */
const shellContextCharacters = 16_000;
const skillModes: readonly SkillMode[] = ["automatic", "manual", "off"];
const editTools = new Set(["write_file", "replace_in_file"]);
const spinner = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const exitWindowMilliseconds = 2_000;
const escapeDelayMilliseconds = 30;
const maxImages = 4;
const modeDetails: Record<AgentMode, string> = {
  chat: "Answer and explain; no file changes",
  plan: "Read the workspace and write a plan",
  edit: "Change files and run commands",
};
const permissionDetails: Record<PermissionMode, string> = {
  ask: "Ask before every tool",
  "auto-read": "Run read-only tools without asking",
  "auto-all": "Run every tool without asking",
};
const skillModeDetails: Record<SkillMode, string> = {
  automatic: "The agent picks skills when they fit",
  manual: "Only skills you select are used",
  off: "No skills",
};

export interface InteractiveChatOptions {
  readonly configuration: ResolvedConfiguration;
  readonly workspaceRoot: string;
  readonly write: (text: string) => void;
  readonly columns: () => number;
  readonly style: Style;
  /** Creates a runtime; the controller owns and disposes it. */
  readonly createRuntime: (
    configuration: ClientConfiguration,
  ) => Promise<ClientRuntime>;
  /** Resolves a named profile for /model. */
  readonly resolveProfile?: (profile: string) => Promise<ResolvedConfiguration>;
  readonly conversations?: ConversationStore;
  readonly now?: () => number;
  /** Status for a terminal workspace manager such as Herdr. */
  readonly agentStatus?: AgentStatusReporter;
  /** The shell command that reopens a conversation, for agentStatus. */
  readonly resumeCommand?: (
    conversationId: string | undefined,
    configuration: ResolvedConfiguration,
  ) => readonly string[];
  /** A saved conversation to continue at start. */
  readonly resumeConversationId?: string;
  /** Models the configured provider offers, for the /model menu. */
  readonly listModels?: (
    configuration: ResolvedConfiguration,
  ) => Promise<readonly string[]>;
  /** Guided provider setup for /setup; resolves the new configuration. */
  readonly setup?: () => Promise<ResolvedConfiguration | undefined>;
  /** Clipboard image for Ctrl+V; undefined when it holds none. */
  readonly readClipboardImage?: () => Promise<ImageData | undefined>;
  /** Runs ! commands typed in chat; defaults to the local shell. */
  readonly shell?: ProcessRunner;
  /** Workspace and global "always allow" rules; defaults to a user file. */
  readonly approvalRules?: ApprovalRuleStore;
}

interface PendingApproval {
  readonly call: ToolCall;
  readonly resolve: (approved: boolean) => void;
}

const scopeKeys: Readonly<Record<string, ApprovalScope>> = {
  a: "conversation",
  w: "workspace",
  g: "global",
};

const scopeNames: Readonly<Record<ApprovalScope, string>> = {
  conversation: "in this conversation",
  workspace: "in this workspace",
  global: "in every workspace",
};

/**
 * Interactive transcript chat. Owns the single stdin reader, the active run
 * and the runtime; rendering stays in the renderer and LiveScreen.
 */
export class InteractiveChat {
  private readonly screen: LiveScreen;
  private readonly decoder = new InputDecoder();
  private readonly formatter: MarkdownRenderer;
  private readonly approval: SwitchableApproval;
  private readonly approvalRules: ApprovalRuleStore;
  /** "Always allow" answers for this conversation; saved with it. */
  private conversationRules: ApprovalRule[] = [];
  private configuration: ResolvedConfiguration;
  private composer: ComposerState = emptyComposer();
  private client: ClientRuntime | undefined;
  private unsubscribe: (() => void) | undefined;
  private sessionId = "";
  private conversationId = newConversationId();
  /** True once this conversation exists in the store and can be resumed. */
  private conversationSaved = false;
  private createdAt = new Date().toISOString();
  /** Skill choices made with /skills or /skill for this conversation. */
  private sessionSkills: Partial<SkillSelection> = {};
  private skillSelection: SkillSelection | undefined;
  private active:
    | { controller: AbortController; done: Promise<void> }
    | undefined;
  private pendingApproval: PendingApproval | undefined;
  /** File edits in flight: input by call id, contents before the edit, and calls already previewed at approval. */
  private readonly edits = new Map<
    string,
    { readonly tool: string; readonly input: Record<string, unknown> }
  >();
  private readonly editsBefore = new Map<string, string>();
  private readonly previewed = new Set<string>();
  private picker:
    | {
        state: PickerState;
        readonly resolve: (item: PickerItem | undefined) => void;
      }
    | undefined;
  /** Images waiting in the draft, keyed by the token shown there. */
  private images: {
    readonly token: string;
    readonly attachment: ChatAttachment;
  }[] = [];
  private imageCount = 0;
  private assistantBuffer = "";
  private progressBuffer = "";
  /** ! command results waiting to go with the next message. */
  private shellContext: string[] = [];
  private usage = { input: 0, output: 0 };
  private spinnerFrame = 0;
  private spinnerTimer: NodeJS.Timeout | undefined;
  private escapeTimer: NodeJS.Timeout | undefined;
  private exitArmedAt: number | undefined;
  private notice: string | undefined;
  private closing = false;
  private resolveClosed!: () => void;
  readonly closed = new Promise<void>((resolve) => {
    this.resolveClosed = resolve;
  });

  constructor(private readonly options: InteractiveChatOptions) {
    this.configuration = options.configuration;
    this.screen = new LiveScreen(options.write, options.columns);
    this.formatter = new MarkdownRenderer({
      style: options.style,
      width: () => options.columns(),
      fences: [mathFenceRenderer, mermaidFenceRenderer],
      inlineMath,
    });
    this.approvalRules =
      options.approvalRules ??
      new FileApprovalRuleStore(
        join(dirname(options.configuration.paths.user), "approvals.json"),
        options.workspaceRoot,
      );
    this.approval = new SwitchableApproval(
      options.configuration.permission,
      (call, signal) => this.askApproval(call, signal),
      (call) => this.remembered(call),
      (call) => this.recordBefore(call),
    );
  }

  async start(): Promise<void> {
    await this.replaceRuntime(this.configuration, []);
    const { style } = this.options;
    this.print(
      `${style.bold(basename(this.options.workspaceRoot))} ${style.dim(
        `· ${this.configuration.provider}/${this.configuration.model}`,
      )}\n${style.dim("Type a message, / for commands, Ctrl+C twice to exit.")}\n`,
    );
    if (this.options.resumeConversationId)
      await this.resumeById(this.options.resumeConversationId).catch(
        (error: unknown) =>
          this.print(
            `${style.error(error instanceof Error ? error.message : String(error))} Starting a new conversation.\n`,
          ),
      );
    await this.refreshSkills();
    this.agentStatus.state("idle");
    this.reportResume();
    this.render();
  }

  private get agentStatus(): AgentStatusReporter {
    return this.options.agentStatus ?? silentAgentStatus;
  }

  private reportResume(): void {
    const id = this.conversationSaved ? this.conversationId : undefined;
    const argv = this.options.resumeCommand?.(id, this.configuration);
    if (argv) this.agentStatus.resumeCommand(id, argv);
  }

  /** Raw terminal input. */
  handleData(chunk: string): void {
    clearTimeout(this.escapeTimer);
    for (const key of this.decoder.push(chunk)) this.handleKey(key);
    if (this.decoder.pending)
      this.escapeTimer = setTimeout(() => {
        for (const key of this.decoder.flush()) this.handleKey(key);
      }, escapeDelayMilliseconds);
  }

  handleResize(): void {
    this.render();
  }

  /** Stops work, saves and releases the runtime. Safe to call twice. */
  async close(): Promise<void> {
    if (this.closing) return this.closed;
    this.closing = true;
    clearTimeout(this.escapeTimer);
    this.stopSpinner();
    this.pendingApproval?.resolve(false);
    this.picker?.resolve(undefined);
    this.picker = undefined;
    this.approval.denyAll();
    this.active?.controller.abort();
    await this.active?.done.catch(() => undefined);
    await this.saveConversation().catch(() => undefined);
    this.unsubscribe?.();
    await this.client?.dispose().catch(() => undefined);
    this.client = undefined;
    this.screen.clear();
    await this.agentStatus.release();
    this.resolveClosed();
    return this.closed;
  }

  private handleKey(key: KeyEvent): void {
    if (this.closing) return;
    if (this.pendingApproval) {
      this.handleApprovalKey(key);
      return;
    }
    if (this.picker) {
      const result = reducePicker(this.picker.state, key);
      this.picker.state = result.state;
      if (result.picked || result.cancelled) {
        const { resolve } = this.picker;
        this.picker = undefined;
        resolve(result.picked);
      }
      this.render();
      return;
    }
    if (key.type === "paste-image") {
      void this.attachImage(async () => {
        const image = await this.options.readClipboardImage?.();
        if (!this.options.readClipboardImage)
          throw new Error("Pasting images is not available here.");
        if (!image)
          throw new Error(
            "The clipboard has no image. Copy one, or paste an image file's path.",
          );
        return image;
      });
      return;
    }
    if (key.type === "paste") {
      const path = imagePathFromText(key.text, this.options.workspaceRoot);
      if (path) {
        // A path that is not a readable image stays as ordinary text.
        void this.attachImage(() => readImageFile(path), key.text);
        return;
      }
    }
    const result = reduceComposer(this.composer, key);
    this.composer = result.state;
    if (key.type !== "interrupt") this.exitArmedAt = undefined;
    const action = result.action;
    if (action?.type === "submit") {
      this.notice = undefined;
      // Commands run in order: a typed-ahead /resume must see /new finish.
      this.submissions = this.submissions.then(() => this.submit(action.text));
    } else if (action?.type === "interrupt") this.interrupt();
    else if (action?.type === "eof") void this.close();
    this.render();
  }

  private handleApprovalKey(key: KeyEvent): void {
    const pending = this.pendingApproval;
    if (!pending) return;
    const answer =
      key.type === "text"
        ? key.text.trim().toLowerCase()
        : key.type === "escape"
          ? "n"
          : key.type === "interrupt"
            ? "stop"
            : "";
    const scope = scopeKeys[answer];
    if (scope) {
      this.pendingApproval = undefined;
      // Remember before resolving so a repeat call in this turn matches.
      void this.remember(scope, ruleFor(pending.call)).finally(() => {
        pending.resolve(true);
        this.render();
      });
      return;
    }
    if (answer === "y" || answer === "n" || answer === "stop") {
      this.pendingApproval = undefined;
      pending.resolve(answer === "y");
      this.print(
        answer === "y"
          ? `  ${this.options.style.success("allowed")}\n`
          : `  ${this.options.style.warning("denied")}\n`,
      );
      if (answer === "stop") this.active?.controller.abort();
      this.render();
    }
  }

  private async remember(
    scope: ApprovalScope,
    rule: ApprovalRule,
  ): Promise<void> {
    const { style } = this.options;
    try {
      if (scope === "conversation") {
        if (!this.conversationRules.some((known) => sameRule(known, rule)))
          this.conversationRules.push(rule);
      } else await this.approvalRules.add(scope, rule);
      this.print(
        `  ${style.success("allowed")} ${style.dim(`· always: ${sanitize(describeRule(rule))} ${scopeNames[scope]}`)}\n`,
      );
    } catch (error) {
      this.print(
        `  ${style.success("allowed")} ${style.warning(`once · could not save: ${error instanceof Error ? error.message : String(error)}`)}\n`,
      );
    }
  }

  private async remembered(call: ToolCall): Promise<boolean> {
    if (this.conversationRules.some((rule) => matchesRule(rule, call)))
      return true;
    const saved = await this.approvalRules.rules().catch(() => undefined);
    return Boolean(
      saved &&
        [...saved.workspace, ...saved.global].some((rule) =>
          matchesRule(rule, call),
        ),
    );
  }

  private async permissionRules(args: string): Promise<void> {
    const { style } = this.options;
    const [action, scope = "conversation"] = args.split(/\s+/);
    if (action === "clear") {
      if (!["conversation", "workspace", "global", "all"].includes(scope)) {
        this.print(
          "Use /permissions clear conversation, workspace, global or all.\n",
        );
        return;
      }
      if (scope === "conversation" || scope === "all")
        this.conversationRules = [];
      if (scope === "workspace" || scope === "all")
        await this.approvalRules.clear("workspace");
      if (scope === "global" || scope === "all")
        await this.approvalRules.clear("global");
      await this.saveConversation();
      this.print(
        `${style.dim(scope === "all" ? "Forgot all saved approvals." : `Forgot ${scope} approvals.`)}\n`,
      );
      return;
    }
    const saved = await this.approvalRules.rules();
    const list = (rules: readonly ApprovalRule[]) =>
      rules.length
        ? rules.map((rule) => sanitize(describeRule(rule))).join(", ")
        : "none";
    this.print(
      `${[
        style.bold("Always allowed"),
        `  This conversation: ${list(this.conversationRules)}`,
        `  This workspace: ${list(saved.workspace)}`,
        `  Every workspace: ${list(saved.global)}`,
        style.dim(
          "  Forget them with /permissions clear [conversation|workspace|global|all].",
        ),
      ].join("\n")}\n`,
    );
  }

  private interrupt(): void {
    if (this.active) {
      this.active.controller.abort();
      this.notice = "Stopping…";
      return;
    }
    if (this.composer.text) {
      this.composer = emptyComposer(this.composer.history);
      return;
    }
    const now = this.options.now?.() ?? Date.now();
    if (
      this.exitArmedAt !== undefined &&
      now - this.exitArmedAt <= exitWindowMilliseconds
    ) {
      void this.close();
      return;
    }
    this.exitArmedAt = now;
    this.notice = "Press Ctrl+C again to exit.";
  }

  private submissions: Promise<void> = Promise.resolve();

  private async submit(text: string): Promise<void> {
    // Kept from the line-mode chat: "--mode edit fix it" switches, then sends.
    const prefixed = text.match(/^--mode\s+(chat|plan|edit)(?:\s+([\s\S]*))?$/);
    if (prefixed) {
      await this.submit(`/mode ${prefixed[1]}`);
      if (prefixed[2]?.trim()) await this.submit(prefixed[2]);
      return;
    }
    const shell = text.match(/^!([\s\S]*)$/);
    if (shell) {
      await this.runShell((shell[1] ?? "").trim(), text);
      return;
    }
    const parsed = parseInput(text);
    if (parsed.kind === "unknown") {
      this.print(
        `${this.options.style.error(`Unknown command /${sanitize(parsed.name)}.`)} Type /help for commands.\n`,
      );
      return;
    }
    if (parsed.kind === "command") {
      try {
        await this.runCommand(parsed.command.name, parsed.args);
      } catch (error) {
        this.print(
          `${this.options.style.error(error instanceof Error ? error.message : String(error))}\n`,
        );
      }
      this.render();
      return;
    }
    if (this.active) {
      // The draft is gone from the composer; put it back rather than lose it.
      this.composer = { ...this.composer, text, cursor: text.length };
      this.notice =
        "A response is still running. Wait, or press Ctrl+C to stop it.";
      this.render();
      return;
    }
    const sent = this.images.filter((image) =>
      parsed.text.includes(image.token),
    );
    this.images = [];
    // Started, not awaited: commands and keys stay live while it streams.
    void this.runPrompt(
      parsed.text,
      sent.map((image) => image.attachment),
    );
  }

  /**
   * Runs a command the user typed after !. The user typed it, so there is no
   * approval; the result goes with the next message so the model sees it.
   */
  private async runShell(command: string, text: string): Promise<void> {
    const { style } = this.options;
    if (!command) {
      this.print(
        `${style.dim("Type a shell command after !, for example !git status.")}\n`,
      );
      return;
    }
    if (this.active) {
      this.composer = { ...this.composer, text, cursor: text.length };
      this.notice =
        "A response is still running. Wait, or press Ctrl+C to stop it.";
      this.render();
      return;
    }
    this.print(`\n${style.accent("$")} ${style.bold(sanitize(command))}\n`);
    const controller = new AbortController();
    const run = (this.options.shell ?? new NodeProcessRunner())
      .run({
        command,
        cwd: this.options.workspaceRoot,
        signal: controller.signal,
        timeoutMs: shellTimeoutMilliseconds,
        maxOutputBytes: shellOutputBytes,
      })
      .catch(
        (error: unknown): ProcessRunResult => ({
          output: error instanceof Error ? error.message : String(error),
          exitCode: null,
          outcome: "error",
          truncated: false,
        }),
      );
    this.active = { controller, done: run.then(() => undefined) };
    this.agentStatus.state("working");
    this.startSpinner();
    this.render();
    let result: ProcessRunResult;
    try {
      result = await run;
    } finally {
      this.active = undefined;
      this.stopSpinner();
      this.notice = undefined;
      if (!this.closing) this.agentStatus.state("idle");
    }
    const output = sanitize(result.output).replace(/\n+$/, "");
    if (output)
      this.print(
        `${output
          .split("\n")
          .map((line) => `  ${line}`)
          .join("\n")}\n`,
      );
    const status =
      result.outcome === "aborted"
        ? "stopped"
        : result.outcome === "timeout"
          ? `timed out after ${shellTimeoutMilliseconds / 60_000} minutes`
          : result.outcome === "exited"
            ? result.exitCode
              ? `exit code ${result.exitCode}`
              : ""
            : "failed";
    if (status) this.print(`  ${style.warning(status)}\n`);
    if (result.truncated) this.print(`  ${style.dim("output truncated")}\n`);
    const shown =
      output.length > shellContextCharacters
        ? `…\n${output.slice(-shellContextCharacters)}`
        : output;
    this.shellContext.push(
      `$ ${command}\n${shown}${status ? `\n[${status}]` : ""}`,
    );
    this.render();
  }

  /** The prompt with any ! command results the model has not seen yet. */
  private withShellContext(prompt: string): string {
    if (!this.shellContext.length) return prompt;
    const blocks = this.shellContext.map(
      (block) => `\`\`\`console\n${block}\n\`\`\``,
    );
    this.shellContext = [];
    return `${prompt}\n\nCommands I ran in the workspace:\n\n${blocks.join("\n\n")}`;
  }

  /** Reads an image and puts its token in the draft. */
  private async attachImage(
    read: () => Promise<ImageData>,
    fallbackText?: string,
  ): Promise<void> {
    const { style } = this.options;
    try {
      if (this.images.length >= maxImages)
        throw new Error(`Up to ${maxImages} images can go in one message.`);
      const image = await read();
      const token = `[image ${++this.imageCount}]`;
      this.images.push({
        token,
        attachment: {
          id: `image-${this.imageCount}`,
          kind: "image",
          name: image.name,
          mediaType: image.mediaType,
          data: `data:${image.mediaType};base64,${image.bytes.toString("base64")}`,
          size: image.bytes.length,
        },
      });
      this.composer = reduceComposer(this.composer, {
        type: "paste",
        text: `${token} `,
      }).state;
      this.notice = `Attached ${image.name} (${Math.max(1, Math.round(image.bytes.length / 1024))} KB).`;
    } catch (error) {
      if (fallbackText !== undefined)
        this.composer = reduceComposer(this.composer, {
          type: "paste",
          text: fallbackText,
        }).state;
      else
        this.print(
          `${style.error(error instanceof Error ? error.message : String(error))}\n`,
        );
    }
    this.render();
  }

  /** Opens a menu in the live region; undefined when cancelled. */
  private choose(
    title: string,
    items: readonly PickerItem[],
    filterable?: boolean,
  ): Promise<PickerItem | undefined> {
    this.picker?.resolve(undefined);
    return new Promise((resolve) => {
      this.picker = { state: openPicker(title, items, filterable), resolve };
      this.render();
    });
  }

  private async runPrompt(
    prompt: string,
    attachments: readonly ChatAttachment[] = [],
  ): Promise<void> {
    const client = this.client;
    if (!client) return;
    const { style } = this.options;
    this.print(
      `\n${formatUserMessage(prompt, this.options.columns(), style)}\n\n`,
    );
    const controller = new AbortController();
    const sent = this.withShellContext(prompt);
    this.usage = { input: 0, output: 0 };
    this.formatter.reset();
    const done = (async () => {
      try {
        await client.runtime.run(
          this.sessionId,
          sent,
          controller.signal,
          [],
          attachments,
        );
      } catch (error) {
        this.flushAssistant();
        if (controller.signal.aborted)
          this.print(`${style.warning("Stopped.")}\n`);
        else
          this.print(
            `${style.error(sanitize(error instanceof Error ? error.message : String(error)))}\n`,
          );
      }
    })();
    this.active = { controller, done };
    this.agentStatus.state("working");
    this.startSpinner();
    try {
      await done;
    } finally {
      this.flushAssistant();
      this.active = undefined;
      this.stopSpinner();
      this.notice = undefined;
      await this.saveConversation().catch((error: unknown) =>
        this.print(
          `${style.dim(`Could not save this conversation: ${error instanceof Error ? error.message : String(error)}`)}\n`,
        ),
      );
      if (!this.closing) this.agentStatus.state("idle");
      this.render();
    }
  }

  private handleEvent(event: RuntimeEvent): void {
    if (event.sessionId !== this.sessionId) return;
    const { style } = this.options;
    const width = this.options.columns();
    switch (event.type) {
      case "text_delta":
        this.appendAssistant(event.text);
        return;
      case "progress_delta":
        this.appendProgress(event.text);
        return;
      case "tool_call_requested":
        this.flushAssistant();
        if (editTools.has(event.tool))
          this.edits.set(event.callId, {
            tool: event.tool,
            input: event.input,
          });
        this.print(
          `${formatToolCall(event.tool, event.input, width, style)}\n`,
        );
        return;
      case "tool_completed":
        this.print(
          `${this.formatEdit(event.callId, event.result) ?? formatToolResult(event.result, width, style)}\n`,
        );
        return;
      case "plan_updated":
        this.flushAssistant();
        this.print(`${this.formatPlan(event.plan)}\n`);
        return;
      case "usage":
        this.usage.input += event.usage.inputTokens;
        this.usage.output += event.usage.outputTokens;
        return;
      case "run_completed": {
        this.flushAssistant();
        const parts: string[] = [];
        if (event.modifiedFiles.length)
          parts.push(
            `changed ${event.modifiedFiles.map((path) => sanitize(path)).join(", ")}`,
          );
        if (this.usage.input || this.usage.output)
          parts.push(
            `${this.usage.input} in · ${this.usage.output} out tokens`,
          );
        if (parts.length) this.print(`\n${style.dim(parts.join(" · "))}\n`);
        return;
      }
      default:
        return;
    }
  }

  private formatPlan(plan: WorkspacePlan): string {
    const { style } = this.options;
    return [
      style.bold(sanitize(plan.title)),
      ...plan.steps.map(
        (step) =>
          `  ${
            step.status === "completed"
              ? style.success("✓")
              : step.status === "in_progress"
                ? style.accent("›")
                : "·"
          } ${sanitize(step.content)}`,
      ),
    ].join("\n");
  }

  /** Progress notes stream in fragments; show them as one growing note. */
  private appendProgress(text: string): void {
    this.flushAssistantText();
    this.progressBuffer += text;
    this.screen.setPending(this.formatProgress());
  }

  private formatProgress(): string {
    const note = sanitize(this.progressBuffer).replace(/\s+/g, " ").trim();
    return note ? this.options.style.dim(`  ${note}`) : "";
  }

  private flushProgress(): void {
    if (!this.progressBuffer) return;
    const note = this.formatProgress();
    this.progressBuffer = "";
    this.screen.setPending("");
    if (note) this.screen.print(`${note}\n`);
  }

  private appendAssistant(text: string): void {
    this.flushProgress();
    this.assistantBuffer += text;
    const end = this.assistantBuffer.lastIndexOf("\n");
    if (end >= 0) {
      const rows = this.assistantBuffer
        .slice(0, end)
        .split("\n")
        .flatMap((line) => this.formatter.push(line));
      this.assistantBuffer = this.assistantBuffer.slice(end + 1);
      this.screen.setPending("");
      if (rows.length) this.screen.print(`${rows.join("\n")}\n`);
    }
    this.screen.setPending(sanitize(this.assistantBuffer));
  }

  private flushAssistant(): void {
    this.flushProgress();
    this.flushAssistantText();
  }

  private flushAssistantText(): void {
    // Tables and diagrams are held until they end; a pause ends them.
    const rows = [
      ...(this.assistantBuffer
        ? this.formatter.push(this.assistantBuffer)
        : []),
      ...this.formatter.end(),
    ];
    this.assistantBuffer = "";
    this.screen.setPending("");
    if (rows.length) this.screen.print(`${rows.join("\n")}\n`);
  }

  private print(text: string): void {
    this.screen.print(text);
  }

  /** Reads a file right before an approved edit runs, for the result diff. */
  private async recordBefore(call: ToolCall): Promise<void> {
    const input = call.input as Record<string, unknown>;
    if (!editTools.has(call.name) || typeof input.path !== "string") return;
    this.editsBefore.set(
      call.id,
      await readFile(
        resolvePath(this.options.workspaceRoot, input.path),
        "utf8",
      ).catch(() => ""),
    );
  }

  /** `⎿ Wrote…`/`⎿ Updated…` with a code preview or numbered diff. */
  private formatEdit(
    callId: string,
    result: { readonly isError?: boolean },
  ): string | undefined {
    const edit = this.edits.get(callId);
    const before = this.editsBefore.get(callId);
    const previewed = this.previewed.delete(callId);
    this.edits.delete(callId);
    this.editsBefore.delete(callId);
    const path = edit?.input.path;
    if (!edit || result.isError || typeof path !== "string") return undefined;
    if (before === undefined && edit.tool !== "write_file") return undefined;
    const after = editedContent(edit.tool, edit.input, before ?? "");
    if (after === undefined) return undefined;
    const { style } = this.options;
    const width = this.options.columns();
    const summary = `  ⎿ ${editSummary(path, before, after, style)}`;
    if (previewed) return summary;
    return [
      summary,
      ...(before
        ? formatDiff(diffRows(before, after), path, width, style)
        : formatCode(after, path, width, style)),
    ].join("\n");
  }

  private async askApproval(
    call: ToolCall,
    signal: AbortSignal,
  ): Promise<boolean> {
    this.flushAssistant();
    const { style } = this.options;
    const preview = await approvalPreview(
      call,
      this.options.workspaceRoot,
      this.options.columns(),
      style,
    );
    if (signal.aborted) return false;
    if (editTools.has(call.name)) this.previewed.add(call.id);
    this.print(
      `${style.warning("?")} ${style.bold("Allow")} ${formatToolSummary(call.name, call.input, this.options.columns() - 8, style)}\n${preview.join("\n")}\n`,
    );
    return new Promise<boolean>((resolve) => {
      const abort = () => {
        if (this.pendingApproval?.resolve === finish)
          this.pendingApproval = undefined;
        resolve(false);
        this.render();
      };
      const finish = (approved: boolean) => {
        signal.removeEventListener("abort", abort);
        this.agentStatus.state("working");
        resolve(approved);
      };
      signal.addEventListener("abort", abort, { once: true });
      this.pendingApproval = { call, resolve: finish };
      this.agentStatus.state("blocked", `Allow ${call.name}?`);
      this.render();
    });
  }

  private async runCommand(name: string, args: string): Promise<void> {
    const { style } = this.options;
    const busy = () => {
      if (this.active)
        throw new Error(
          "Wait for the current response, or press Ctrl+C to stop it.",
        );
    };
    switch (name) {
      case "help":
        this.print(`${formatHelp(interactiveCommands, style)}\n`);
        return;
      case "quit":
        await this.close();
        return;
      case "new":
        busy();
        await this.saveConversation();
        await this.startConversation([]);
        this.print(`${style.dim("Started a new conversation.")}\n`);
        return;
      case "mode": {
        busy();
        const mode = (args ||
          (
            await this.choose(
              "Mode",
              modes.map((value) => ({
                label: value,
                value,
                detail: modeDetails[value],
                current: value === (this.configuration.mode ?? "chat"),
              })),
            )
          )?.value) as AgentMode | undefined;
        if (!mode) return;
        if (!modes.includes(mode)) {
          this.print(
            `Mode is ${this.configuration.mode}. Use /mode chat, plan or edit.\n`,
          );
          return;
        }
        await this.switchConfiguration({ ...this.configuration, mode });
        this.print(
          `${style.dim(`Mode: ${mode}. The conversation continues.`)}\n`,
        );
        return;
      }
      case "permissions": {
        if (/^(?:rules|clear)\b/.test(args)) {
          await this.permissionRules(args);
          return;
        }
        const permission = (args ||
          (
            await this.choose(
              "Tool approval",
              permissions.map((value) => ({
                label: value,
                value,
                detail: permissionDetails[value],
                current: value === this.approval.mode,
              })),
            )
          )?.value) as PermissionMode | undefined;
        if (!permission) return;
        if (!permissions.includes(permission)) {
          this.print(
            `Permissions are ${this.approval.mode}. Use /permissions ask, auto-read or auto-all.\n`,
          );
          return;
        }
        this.approval.mode = permission;
        this.configuration = { ...this.configuration, permission };
        this.print(`${style.dim(`Tool permissions: ${permission}.`)}\n`);
        return;
      }
      case "model": {
        if (!args) {
          await this.chooseModel();
          return;
        }
        busy();
        if (!this.options.resolveProfile)
          throw new Error("Profiles are not available here.");
        const next = await this.options.resolveProfile(args);
        await this.switchConfiguration({
          ...next,
          mode: this.configuration.mode,
          permission: this.approval.mode,
        });
        this.print(
          `${style.dim(`Model: ${next.provider}/${next.model}. The conversation continues.`)}\n`,
        );
        return;
      }
      case "setup": {
        busy();
        const setup = this.options.setup;
        if (!setup) throw new Error("Setup is not available here.");
        this.screen.clear();
        const next = await setup();
        if (!next) {
          this.print(`${style.dim("Setup cancelled.")}\n`);
          return;
        }
        this.approval.mode = next.permission;
        await this.switchConfiguration(next);
        this.print(
          `${style.dim(`Now using ${next.provider}/${next.model}. The conversation continues.`)}\n`,
        );
        return;
      }
      case "status": {
        const lines = [
          `Mode ${this.configuration.mode} · ${this.configuration.provider}/${this.configuration.model} · permissions ${this.approval.mode}`,
          `Conversation ${this.conversationId.slice(0, 8)} · ${(await this.messages()).length} messages`,
          this.skillSelection
            ? `Skills ${this.skillSelection.mode} · Superpowers ${this.skillSelection.superpowersEnabled ? "on" : "off"} · always active: ${this.skillSelection.skillIds.join(", ") || "none"}`
            : "",
        ].filter(Boolean);
        const workspace = await executeWorkspaceCommand({
          workspaceRoot: this.options.workspaceRoot,
          input: "/status",
        });
        this.print(`${lines.join("\n")}\n\n${sanitize(workspace.message)}\n`);
        return;
      }
      case "init":
      case "update":
      case "clear-memory": {
        const result = await executeWorkspaceCommand({
          workspaceRoot: this.options.workspaceRoot,
          input: `/${name}${args ? ` ${args}` : ""}`,
        });
        this.print(`${sanitize(result.message)}\n`);
        return;
      }
      case "skills":
        await this.skillsCommand(args);
        return;
      case "skill":
        await this.toggleSkill(args);
        return;
      case "agents": {
        const profiles = await new FileAgentProfileStore(
          this.options.workspaceRoot,
        ).list();
        this.print(
          profiles.length
            ? `${profiles.map((profile) => `  ${sanitize(profile.displayName)} ${style.dim(`${profile.provider.providerId}/${profile.provider.modelId} · ${profile.mode}`)}`).join("\n")}\n`
            : `No managed agent profiles. Add one with \`truss-cli agents add <name>\`.\n`,
        );
        return;
      }
      case "mcp": {
        const servers = this.client?.mcpServers ?? [];
        this.print(
          servers.length
            ? `${servers.map((server) => `  ${sanitize(server.name)} ${server.state}${server.error ? ` ${style.error(sanitize(server.error))}` : ` · ${server.toolCount} tools`}`).join("\n")}\n`
            : "No MCP servers configured.\n",
        );
        return;
      }
      case "resume":
        busy();
        await this.resume(args);
        return;
    }
  }

  /** Provider models plus a setup entry; switching keeps the conversation. */
  private async chooseModel(): Promise<void> {
    const { style } = this.options;
    let models: readonly string[] = [];
    if (this.options.listModels) {
      this.notice = "Loading models…";
      this.render();
      try {
        models = await this.options.listModels(this.configuration);
      } catch (error) {
        this.print(
          `${style.dim(`Could not list models: ${error instanceof Error ? error.message : String(error)}`)}\n`,
        );
      } finally {
        this.notice = undefined;
      }
    }
    const setup = "\u0000setup";
    const picked = await this.choose(
      `Model · ${this.configuration.provider}`,
      [
        ...(models.includes(this.configuration.model)
          ? models
          : [this.configuration.model, ...models]
        ).map((model) => ({
          label: model,
          value: model,
          current: model === this.configuration.model,
        })),
        ...(this.options.setup
          ? [
              {
                label: "Change provider or API key…",
                value: setup,
                detail: "/setup",
              },
            ]
          : []),
      ],
      models.length > 8,
    );
    if (!picked || picked.value === this.configuration.model) return;
    if (picked.value === setup) {
      await this.runCommand("setup", "");
      return;
    }
    if (this.active)
      throw new Error(
        "Wait for the current response, or press Ctrl+C to stop it.",
      );
    await this.switchConfiguration({
      ...this.configuration,
      model: picked.value,
    });
    this.print(
      `${style.dim(`Model: ${picked.value} for this session. /setup saves a new default.`)}\n`,
    );
  }

  private async skillsCommand(args: string): Promise<void> {
    const service = skillServiceHost(
      this.configuration.skills,
      this.options.workspaceRoot,
    );
    if (!args) {
      const current = this.skillSelection?.mode;
      const picked = await this.choose("Skills", [
        ...skillModes.map((value) => ({
          label: value,
          value,
          detail: skillModeDetails[value],
          current: value === current,
        })),
        { label: "list", value: "list", detail: "Show every skill" },
      ]);
      if (!picked) return;
      if (picked.value !== "list") args = picked.value;
    }
    if (args) {
      const mode = args as SkillMode;
      if (!skillModes.includes(mode))
        throw new Error(
          "Use /skills automatic, /skills manual or /skills off.",
        );
      await this.setSessionSkills({ mode });
      this.print(
        `${this.options.style.dim(`Skills: ${mode} for this conversation. Use \`truss-cli skills mode\` to change the default.`)}\n`,
      );
      return;
    }
    const state = await service.list(this.sessionId);
    this.skillSelection = state.selection;
    const selected = new Set(state.selection.skillIds);
    const { style } = this.options;
    this.print(
      `${[
        `Skills ${state.selection.mode} · Superpowers ${state.selection.superpowersEnabled ? "on" : "off"}`,
        ...state.skills.map(
          (skill) =>
            `  ${selected.has(skill.id) ? style.success("●") : "○"} ${skill.id}${skill.trusted ? "" : style.dim(" (untrusted: import to use)")} ${style.dim(truncateDescription(skill.description))}`,
        ),
        style.dim(
          "/skill <id> toggles an always-active skill for this conversation.",
        ),
      ].join("\n")}\n`,
    );
  }

  private async toggleSkill(id: string): Promise<void> {
    if (!id)
      throw new Error(
        "Use /skill <id>, for example /skill superpowers:brainstorming.",
      );
    const current = this.skillSelection?.skillIds ?? [];
    const skillIds = current.includes(id)
      ? current.filter((skillId) => skillId !== id)
      : [...current, id];
    await this.setSessionSkills({ skillIds });
    this.print(
      `${this.options.style.dim(`${skillIds.includes(id) ? "Always active" : "No longer always active"}: ${id}. Applies from the next message.`)}\n`,
    );
  }

  private async setSessionSkills(
    change: Partial<SkillSelection>,
  ): Promise<void> {
    const service = skillServiceHost(
      this.configuration.skills,
      this.options.workspaceRoot,
    );
    const state = await service.setSettings("session", this.sessionId, change);
    this.sessionSkills = { ...this.sessionSkills, ...change };
    this.skillSelection = state.selection;
  }

  private async refreshSkills(): Promise<void> {
    try {
      this.skillSelection = (
        await skillServiceHost(
          this.configuration.skills,
          this.options.workspaceRoot,
        ).list(this.sessionId)
      ).selection;
    } catch {
      this.skillSelection = undefined;
    }
  }

  private async resume(args: string): Promise<void> {
    const store = this.options.conversations;
    if (!store) throw new Error("Saved conversations are not available here.");
    const saved = (await store.list()).filter(
      (conversation) => conversation.id !== this.conversationId,
    );
    const { style } = this.options;
    if (!args) {
      this.print(
        saved.length
          ? `${saved
              .slice(0, 20)
              .map(
                (conversation, index) =>
                  `  ${String(index + 1).padStart(2)} ${sanitize(conversation.title)} ${style.dim(`· ${conversation.messageCount} messages · ${conversation.updatedAt.slice(0, 16).replace("T", " ")}`)}`,
              )
              .join("\n")}\n${style.dim("/resume <number> continues one.")}\n`
          : "No saved conversations for this workspace yet.\n",
      );
      return;
    }
    const index = Number.parseInt(args, 10) - 1;
    const summary = saved[index];
    if (!summary)
      throw new Error(
        `No saved conversation ${args}. Use /resume to list them.`,
      );
    await this.resumeById(summary.id);
  }

  private async resumeById(id: string): Promise<void> {
    const store = this.options.conversations;
    // The short ID shown by /status is enough when it is unambiguous.
    const matches = store
      ? (await store.list()).filter((summary) => summary.id.startsWith(id))
      : [];
    const conversation =
      (await store?.load(id)) ??
      (matches.length === 1 && matches[0]
        ? await store?.load(matches[0].id)
        : undefined);
    if (!conversation)
      throw new Error(
        `No saved conversation ${sanitize(id)} in this workspace.`,
      );
    await this.saveConversation();
    await this.startConversation(repairForResume(conversation.messages));
    this.conversationRules = validRules(conversation.approvals);
    const permission = conversation.permission as PermissionMode | undefined;
    if (permission && permissions.includes(permission)) {
      this.approval.mode = permission;
      this.configuration = { ...this.configuration, permission };
    }
    this.conversationId = conversation.id;
    this.createdAt = conversation.createdAt;
    this.conversationSaved = true;
    this.reportResume();
    this.print(
      `${this.options.style.dim(`Resumed "${sanitize(conversation.title)}" (${conversation.messages.length} messages). Unfinished tool calls are marked as unknown and are not run again. Tool permissions: ${this.approval.mode}.`)}\n`,
    );
  }

  private async messages() {
    return (
      (await this.client?.runtime.getSession(this.sessionId))?.messages ?? []
    );
  }

  private async saveConversation(): Promise<void> {
    const store = this.options.conversations;
    if (!store || !this.client) return;
    const messages = await this.messages();
    if (!messages.some((message) => message.role === "user")) return;
    await store.save({
      id: this.conversationId,
      title: conversationTitle(messages),
      workspaceRoot: this.options.workspaceRoot,
      provider: this.configuration.provider,
      model: this.configuration.model,
      mode: this.configuration.mode ?? "chat",
      permission: this.approval.mode,
      ...(this.conversationRules.length
        ? { approvals: this.conversationRules }
        : {}),
      createdAt: this.createdAt,
      updatedAt: new Date().toISOString(),
      // Image bytes would overflow the store; names and types are kept.
      messages: messages.map((message) =>
        message.attachments?.length
          ? {
              ...message,
              attachments: message.attachments.map(
                ({ data: _data, ...attachment }) => attachment,
              ),
            }
          : message,
      ),
    });
    if (!this.conversationSaved) {
      this.conversationSaved = true;
      this.reportResume();
    }
  }

  private async startConversation(
    messages: Parameters<ClientRuntime["runtime"]["createSession"]>[0],
  ): Promise<void> {
    const client = this.client;
    if (!client) return;
    this.sessionId = (await client.runtime.createSession(messages)).id;
    this.conversationId = newConversationId();
    this.createdAt = new Date().toISOString();
    this.conversationSaved = false;
    this.reportResume();
    this.sessionSkills = {};
    this.shellContext = [];
    this.conversationRules = [];
    await this.refreshSkills();
  }

  /** Mode or model change: new runtime, same conversation. */
  private async switchConfiguration(
    next: ResolvedConfiguration,
  ): Promise<void> {
    const messages = await this.messages();
    await this.replaceRuntime(next, messages);
    // Skill choices for this conversation follow it to the new session.
    if (Object.keys(this.sessionSkills).length)
      await skillServiceHost(
        next.skills,
        this.options.workspaceRoot,
      ).setSettings("session", this.sessionId, this.sessionSkills);
    await this.refreshSkills();
    // The resume command carries the mode and profile.
    this.reportResume();
  }

  private async replaceRuntime(
    next: ResolvedConfiguration,
    messages: Parameters<ClientRuntime["runtime"]["createSession"]>[0],
  ): Promise<void> {
    const client = await this.options.createRuntime({
      ...next,
      approval: this.approval,
    });
    const previous = this.client;
    this.unsubscribe?.();
    this.client = client;
    this.configuration = next;
    this.unsubscribe = client.events.subscribe((event) =>
      this.handleEvent(event),
    );
    this.sessionId = (await client.runtime.createSession(messages)).id;
    await previous?.dispose();
  }

  private startSpinner(): void {
    this.stopSpinner();
    this.spinnerTimer = setInterval(() => {
      this.spinnerFrame = (this.spinnerFrame + 1) % spinner.length;
      this.render();
    }, 120);
    this.spinnerTimer.unref?.();
  }

  private stopSpinner(): void {
    clearInterval(this.spinnerTimer);
    this.spinnerTimer = undefined;
  }

  private status(): string {
    if (this.pendingApproval)
      return "Allow this? y once · a always in chat · w in workspace · g everywhere · n no";
    const parts = [
      this.configuration.mode ?? "chat",
      this.configuration.model,
      this.approval.mode,
      ...(this.skillSelection ? [`skills ${this.skillSelection.mode}`] : []),
    ];
    const base = parts.join(" · ");
    if (this.notice) return `${this.notice}  ${base}`;
    if (this.active)
      return `${spinner[this.spinnerFrame]} working · Ctrl+C stops · ${base}`;
    return base;
  }

  private render(): void {
    if (this.closing) return;
    if (this.picker && !this.pendingApproval) {
      const width = this.options.columns();
      const view = renderPicker(this.picker.state, width, this.options.style);
      this.screen.render({
        lines: [
          this.options.style.dim(truncate(this.status(), width - 1)),
          ...view.lines,
        ],
        cursorRow: view.cursorRow + 1,
        cursorColumn: view.cursorColumn,
      });
      return;
    }
    this.screen.render(
      renderComposer({
        state: this.composer,
        width: this.options.columns(),
        status: this.status(),
        menu: this.pendingApproval ? [] : menuCommands(this.composer),
        style: this.options.style,
        placeholder: this.pendingApproval
          ? "Type y or n"
          : "Ask anything, or / for commands",
      }),
    );
  }
}

function truncateDescription(text: string): string {
  const line = sanitize(text).split("\n")[0] ?? "";
  return line.length > 70 ? `${line.slice(0, 69)}…` : line;
}
