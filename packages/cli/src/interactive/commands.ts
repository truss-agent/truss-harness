import { workspaceCommands } from "@truss-harness/runtime";

export type InteractiveCommandName =
  | "help"
  | "model"
  | "mode"
  | "permissions"
  | "new"
  | "setup"
  | "resume"
  | "status"
  | "init"
  | "update"
  | "clear-memory"
  | "skills"
  | "skill"
  | "agents"
  | "mcp"
  | "quit";

export interface InteractiveCommand {
  readonly name: InteractiveCommandName;
  readonly usage: string;
  readonly summary: string;
  /** Workspace commands run in the shared runtime without a model call. */
  readonly workspace?: boolean;
}

const workspaceSummary = (name: string): string =>
  workspaceCommands.find((command) => command.name === `/${name}`)
    ?.description ?? "";

export const interactiveCommands: readonly InteractiveCommand[] = [
  { name: "help", usage: "/help", summary: "Show commands and keys" },
  {
    name: "model",
    usage: "/model [profile]",
    summary: "Choose a model, or switch to a saved profile",
  },
  {
    name: "mode",
    usage: "/mode [chat|plan|edit]",
    summary: "Switch agent mode and keep the conversation",
  },
  {
    name: "permissions",
    usage: "/permissions [ask|auto-read|auto-all]",
    summary: "Choose how tool requests are approved",
  },
  { name: "new", usage: "/new", summary: "Start a new conversation" },
  {
    name: "setup",
    usage: "/setup",
    summary: "Connect a provider, API key and model",
  },
  {
    name: "resume",
    usage: "/resume [number]",
    summary: "List saved conversations or resume one",
  },
  {
    name: "status",
    usage: "/status",
    summary: "Show session, model and repository state",
  },
  {
    name: "init",
    usage: "/init",
    summary: workspaceSummary("init"),
    workspace: true,
  },
  {
    name: "update",
    usage: "/update [note]",
    summary: workspaceSummary("update"),
    workspace: true,
  },
  {
    name: "clear-memory",
    usage: "/clear-memory",
    summary: workspaceSummary("clear-memory"),
    workspace: true,
  },
  {
    name: "skills",
    usage: "/skills [automatic|manual|off]",
    summary: "Show skills or change the skill mode",
  },
  {
    name: "skill",
    usage: "/skill <id>",
    summary: "Toggle an always-active skill for this conversation",
  },
  { name: "agents", usage: "/agents", summary: "List managed agent profiles" },
  { name: "mcp", usage: "/mcp", summary: "Show MCP server status" },
  { name: "quit", usage: "/quit", summary: "Exit" },
];

/** Earlier `:command` controls keep working. */
const colonAliases: Record<string, string> = {
  ":help": "/help",
  ":exit": "/quit",
  ":quit": "/quit",
  ":clear": "/new",
  ":mode": "/mode",
};

export type ParsedInput =
  | { readonly kind: "prompt"; readonly text: string }
  | {
      readonly kind: "command";
      readonly command: InteractiveCommand;
      readonly args: string;
    }
  | { readonly kind: "unknown"; readonly name: string };

/** Classifies submitted text; slash input never becomes a model prompt. */
export function parseInput(text: string): ParsedInput {
  const trimmed = text.trim();
  const alias = colonAliases[trimmed.split(/\s+/)[0] ?? ""];
  const normalized = alias
    ? `${alias}${trimmed.slice(trimmed.split(/\s+/)[0]?.length ?? 0)}`
    : trimmed;
  if (!normalized.startsWith("/") || normalized.startsWith("//"))
    return {
      kind: "prompt",
      text: normalized.startsWith("//") ? normalized.slice(1) : text,
    };
  const [head = "", ...rest] = normalized.slice(1).split(/\s+/);
  const command = interactiveCommands.find((entry) => entry.name === head);
  if (!command) return { kind: "unknown", name: head };
  return { kind: "command", command, args: rest.join(" ").trim() };
}

/** Commands whose name starts with what follows the slash. */
export function filterCommands(
  draft: string,
  commands: readonly InteractiveCommand[] = interactiveCommands,
): readonly InteractiveCommand[] {
  if (!draft.startsWith("/") || /\s/.test(draft)) return [];
  const query = draft.slice(1).toLowerCase();
  return commands.filter((command) => command.name.startsWith(query));
}
