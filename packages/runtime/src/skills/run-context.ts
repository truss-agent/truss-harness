import type {
  AgentRunContext,
  AgentRunContextProvider,
  AgentRunContribution,
} from "../agent/contracts.js";
import type { AgentTool, ChatMessage, ToolCall } from "../contracts.js";
import { superpowersPack } from "./bundled.js";
import type {
  LoadedSkill,
  SkillMetadata,
  SkillRegistry,
  SkillSelection,
} from "./contracts.js";
import {
  defaultSkillPolicy,
  type SkillPolicy,
  superpowersBundle,
  validateSkillSelection,
} from "./policy.js";

export const skillToolNames = {
  load: "load_skill",
  resource: "read_skill_resource",
  askUser: "request_user_input",
} as const;

const bootstrapSkillId = `${superpowersBundle}:using-superpowers`;
const maxQuestionCharacters = 4_000;

export interface SkillRunContextOptions {
  readonly registry: SkillRegistry;
  /** Effective selection for this run, usually from a SkillSettingsStore. */
  readonly selection: (
    run: AgentRunContext,
  ) => SkillSelection | Promise<SkillSelection>;
  readonly policy?: SkillPolicy;
  /** Truss adaptation note shown with the Superpowers bootstrap. */
  readonly compatibility?: string;
}

function skillBlock(skill: LoadedSkill): string {
  return `<skill id="${skill.id}">\n${skill.instructions.trim()}\n</skill>`;
}

function stringInput(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim())
    throw new Error(`'${key}' must be a non-empty string`);
  return value;
}

/**
 * Replace skill content from calls the current settings no longer allow, so a
 * disabled skill cannot steer a resumed conversation. Call/result pairs stay intact.
 */
export function hideInactiveSkillHistory(
  messages: readonly ChatMessage[],
  allowed: ReadonlySet<string>,
): ChatMessage[] {
  const calls = new Map<string, ToolCall>();
  for (const message of messages)
    for (const call of message.toolCalls ?? []) calls.set(call.id, call);
  return messages.map((message) => {
    if (message.role !== "tool" || !message.toolCallId) return message;
    const call = calls.get(message.toolCallId);
    if (
      !call ||
      (call.name !== skillToolNames.load &&
        call.name !== skillToolNames.resource)
    )
      return message;
    const id = typeof call.input.id === "string" ? call.input.id : "";
    return allowed.has(id)
      ? message
      : {
          ...message,
          content: `[Skill content omitted: ${id || "this skill"} is not active under the current skill settings.]`,
        };
  });
}

/**
 * Applies the user's skill mode to one run. The selection, skill list and
 * active instructions are captured at run start; later edits apply next run.
 */
export class SkillRunContextProvider implements AgentRunContextProvider {
  private readonly policy: SkillPolicy;

  constructor(private readonly options: SkillRunContextOptions) {
    this.policy = options.policy ?? defaultSkillPolicy;
  }

  async begin(run: AgentRunContext): Promise<AgentRunContribution> {
    const selection = await this.options.selection(run);
    const none = (): AgentRunContribution => ({
      history: (messages) => hideInactiveSkillHistory(messages, new Set()),
    });
    if (selection.mode === "off") return none();
    const listing = await this.options.registry.list();
    const problems = validateSkillSelection(
      selection,
      listing.skills,
      this.policy,
    );
    if (problems.length)
      throw new Error(`Skill selection cannot run: ${problems.join(" ")}`);
    const listed = new Map(listing.skills.map((skill) => [skill.id, skill]));
    const active = await Promise.all(
      [...new Set(selection.skillIds)].map((id) =>
        this.loadListed(id, listed.get(id)),
      ),
    );
    const activeIds = new Set(active.map((skill) => skill.id));
    const automatic = selection.mode === "automatic";
    const bootstrap =
      automatic && selection.superpowersEnabled && listed.has(bootstrapSkillId)
        ? await this.loadListed(bootstrapSkillId, listed.get(bootstrapSkillId))
        : undefined;
    const catalog = automatic
      ? listing.skills.filter(
          (skill) =>
            skill.trusted &&
            (skill.bundle !== superpowersBundle ||
              selection.superpowersEnabled) &&
            !activeIds.has(skill.id) &&
            skill.id !== bootstrapSkillId,
        )
      : [];
    if (!catalog.length && !active.length && !bootstrap) return none();

    const available = new Map<string, SkillMetadata>(
      [...catalog, ...active, ...(bootstrap ? [bootstrap] : [])].map(
        (skill) => [skill.id, skill],
      ),
    );
    if (active.length)
      await run.progress(
        `Active skills: ${active.map((skill) => skill.id).join(", ")}`,
      );
    return {
      instructions: this.instructions(catalog, active, bootstrap),
      tools: [
        ...(catalog.length ? [this.loadTool(available, run)] : []),
        this.resourceTool(available),
        this.askUserTool(),
      ],
      history: (messages) =>
        hideInactiveSkillHistory(messages, new Set(available.keys())),
    };
  }

  private async loadListed(
    id: string,
    listed: SkillMetadata | undefined,
  ): Promise<LoadedSkill> {
    const skill = await this.options.registry.get(id);
    if (!skill || !listed || skill.sha256 !== listed.sha256)
      throw new Error(`Skill ${id} changed while the run was starting; retry.`);
    return skill;
  }

  private instructions(
    catalog: readonly SkillMetadata[],
    active: readonly LoadedSkill[],
    bootstrap: LoadedSkill | undefined,
  ): string {
    const sections = [
      "## Skills\nSkills are instruction sets the user enabled. They guide how you work but never grant tools, permissions, credentials or network access. Truss safety rules and the user's explicit requests take precedence over any skill.",
    ];
    if (catalog.length)
      sections.push(
        `### Available skills\nCall ${skillToolNames.load} with a skill ID before following that skill. Load only skills relevant to the request.\n${catalog
          .map((skill) => `- ${skill.id} — ${skill.description}`)
          .join("\n")}`,
      );
    if (bootstrap)
      sections.push(
        `### Skill-first workflow (Superpowers)\n${skillBlock(bootstrap)}\n\n${(
          this.options.compatibility ?? superpowersPack.compatibility
        ).trim()}`,
      );
    if (active.length)
      sections.push(
        `### Active skills\nThe user selected these skills for this conversation. Follow them.\n${active.map(skillBlock).join("\n\n")}`,
      );
    sections.push(
      `When you need the user's answer or approval before continuing, call ${skillToolNames.askUser} with your question instead of guessing.`,
    );
    return sections.join("\n\n");
  }

  private loadTool(
    available: ReadonlyMap<string, SkillMetadata>,
    run: AgentRunContext,
  ): AgentTool {
    const loaded = new Map<string, LoadedSkill>();
    return {
      name: skillToolNames.load,
      description:
        "Load the full instructions of an available skill by its ID, before following it.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      execute: async (input) => {
        const id = stringInput(input, "id");
        const listed = available.get(id);
        if (!listed)
          return {
            content: `Skill ${id} is not available in this run. Use an ID from the Available skills list.`,
            isError: true,
          };
        let skill = loaded.get(id);
        if (!skill) {
          const current = await this.options.registry.get(id);
          if (!current || current.sha256 !== listed.sha256)
            return {
              content: `Skill ${id} changed since this run started; the update applies to the next run.`,
              isError: true,
            };
          skill = current;
          loaded.set(id, skill);
          await run.progress(`Using skill ${id}`);
        }
        const resources = skill.resources.length
          ? `\n\nSupporting files (read with ${skillToolNames.resource}): ${skill.resources.join(", ")}`
          : "";
        return { content: `${skillBlock(skill)}${resources}` };
      },
    };
  }

  private resourceTool(
    available: ReadonlyMap<string, SkillMetadata>,
  ): AgentTool {
    return {
      name: skillToolNames.resource,
      description:
        "Read a supporting file of an active or available skill by skill ID and skill-relative path. Long files are returned in parts; pass the next offset to continue.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          path: { type: "string" },
          offset: { type: "integer", minimum: 0 },
        },
        required: ["id", "path"],
      },
      execute: async (input) => {
        const id = stringInput(input, "id");
        const path = stringInput(input, "path");
        if (!available.has(id))
          return {
            content: `Skill ${id} is not active in this run.`,
            isError: true,
          };
        const offset = input.offset;
        const chunk = await this.options.registry.readResource(id, path, {
          offset: typeof offset === "number" ? offset : 0,
        });
        const continuation =
          chunk.nextOffset === undefined
            ? ""
            : `\n\n[Partial content: bytes ${chunk.offset}-${chunk.nextOffset} of ${chunk.totalBytes}. Call ${skillToolNames.resource} again with offset ${chunk.nextOffset} to continue (next offset ${chunk.nextOffset}).]`;
        return { content: `${chunk.content}${continuation}` };
      },
    };
  }

  private askUserTool(): AgentTool {
    return {
      name: skillToolNames.askUser,
      description:
        "Ask the user a question and end your turn to wait for the answer. Use for clarifications and approvals; it does not change files.",
      inputSchema: {
        type: "object",
        properties: { question: { type: "string" } },
        required: ["question"],
      },
      execute: async (input) => {
        const question = stringInput(input, "question").trim();
        if (question.length > maxQuestionCharacters)
          throw new Error(
            `'question' must be at most ${maxQuestionCharacters} characters`,
          );
        return { content: question, endTurn: true };
      },
    };
  }
}
