import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";
import {
  FileWorkspaceStorageOwnership,
  type ToolCall,
  type WorkspaceStorageOwnership,
} from "@truss-harness/runtime";
import { toolLabels } from "./renderer.js";

/** A remembered "always allow": a tool, and for terminal runs a command prefix. */
export interface ApprovalRule {
  readonly tool: string;
  readonly command?: string;
}

export type ApprovalScope = "conversation" | "workspace" | "global";

export interface ApprovalRuleStore {
  rules(): Promise<{
    readonly workspace: readonly ApprovalRule[];
    readonly global: readonly ApprovalRule[];
  }>;
  add(scope: "workspace" | "global", rule: ApprovalRule): Promise<void>;
  clear(scope: "workspace" | "global"): Promise<void>;
}

/** Chaining, pipes, redirection and substitution: never covered by a rule. */
const shellControl = /[;&|<>`\n\r]|\$\(/;

function terminalCommand(call: ToolCall): string | undefined {
  const command = (call.input as Record<string, unknown> | undefined)?.command;
  return typeof command === "string" ? command.trim() : undefined;
}

/** The rule an "always allow" answer creates for this call. */
export function ruleFor(call: ToolCall): ApprovalRule {
  const command = call.name === "run_terminal" ? terminalCommand(call) : "";
  if (!command) return { tool: call.name };
  const [program = "", next] = command.split(/\s+/);
  // "npm test" and "git status" keep their subcommand; "ls -la" is just "ls".
  return {
    tool: call.name,
    command:
      next && /^[\w:.-]+$/.test(next) && !next.startsWith("-")
        ? `${program} ${next}`
        : program,
  };
}

export function matchesRule(rule: ApprovalRule, call: ToolCall): boolean {
  if (rule.tool !== call.name) return false;
  if (rule.command === undefined) return call.name !== "run_terminal";
  const command = terminalCommand(call);
  if (!command || shellControl.test(command)) return false;
  return command === rule.command || command.startsWith(`${rule.command} `);
}

export function describeRule(rule: ApprovalRule): string {
  const label = toolLabels[rule.tool] ?? rule.tool;
  return rule.command ? `${label} ${rule.command}…` : label;
}

function isRule(value: unknown): value is ApprovalRule {
  const rule = value as Record<string, unknown> | null;
  return Boolean(
    rule &&
      typeof rule.tool === "string" &&
      rule.tool &&
      (rule.command === undefined ||
        (typeof rule.command === "string" && rule.command)),
  );
}

export function validRules(value: unknown): ApprovalRule[] {
  return Array.isArray(value) && value.every(isRule) ? value : [];
}

export function sameRule(left: ApprovalRule, right: ApprovalRule): boolean {
  return left.tool === right.tool && left.command === right.command;
}

interface ApprovalFile {
  readonly global: readonly ApprovalRule[];
  readonly workspaces: Readonly<Record<string, readonly ApprovalRule[]>>;
}

/**
 * Workspace and global rules in a user-owned file, keyed by the canonical
 * workspace path, so a repository can never pre-approve its own tools.
 */
export class FileApprovalRuleStore implements ApprovalRuleStore {
  constructor(
    readonly path: string,
    private readonly workspaceRoot: string,
    private readonly ownership: WorkspaceStorageOwnership = new FileWorkspaceStorageOwnership(),
  ) {}

  async rules() {
    const [file, key] = await Promise.all([this.read(), this.key()]);
    return { workspace: file.workspaces[key] ?? [], global: file.global };
  }

  add(scope: "workspace" | "global", rule: ApprovalRule): Promise<void> {
    return this.update(scope, (rules) =>
      rules.some((existing) => sameRule(existing, rule))
        ? rules
        : [...rules, rule],
    );
  }

  clear(scope: "workspace" | "global"): Promise<void> {
    return this.update(scope, () => []);
  }

  private async update(
    scope: "workspace" | "global",
    change: (rules: readonly ApprovalRule[]) => readonly ApprovalRule[],
  ): Promise<void> {
    const key = await this.key();
    await this.ownership.run(this.path, async () => {
      const file = await this.read();
      const next: ApprovalFile =
        scope === "global"
          ? { ...file, global: change(file.global) }
          : {
              ...file,
              workspaces: {
                ...file.workspaces,
                [key]: change(file.workspaces[key] ?? []),
              },
            };
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, {
          encoding: "utf8",
          mode: 0o600,
        });
        await rename(temporary, this.path);
      } finally {
        await rm(temporary, { force: true });
      }
    });
  }

  private async read(): Promise<ApprovalFile> {
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(await readFile(this.path, "utf8"));
    } catch {
      return { global: [], workspaces: {} };
    }
    const workspaces =
      value.workspaces &&
      typeof value.workspaces === "object" &&
      !Array.isArray(value.workspaces)
        ? Object.fromEntries(
            Object.entries(value.workspaces).map(([key, rules]) => [
              key,
              validRules(rules),
            ]),
          )
        : {};
    return { global: validRules(value.global), workspaces };
  }

  private key(): Promise<string> {
    return realpath(this.workspaceRoot).catch(() => this.workspaceRoot);
  }
}
