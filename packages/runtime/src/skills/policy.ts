import {
  defaultSkillSelection,
  type SkillMetadata,
  type SkillSelection,
  skillModes,
} from "./contracts.js";
import { isSkillName } from "./frontmatter.js";

/** Injectable limits; the model's overall context budget still applies on top. */
export interface SkillPolicy {
  readonly maxSkillBytes: number;
  readonly maxSelectedSkills: number;
  readonly maxSelectedInstructionBytes: number;
  /** Largest single resource chunk returned to a model. */
  readonly maxResourceReadBytes: number;
  /** Largest resource file accepted by an import. */
  readonly maxResourceBytes: number;
  readonly maxResourcesPerSkill: number;
  readonly maxResourceDepth: number;
}

export const defaultSkillPolicy: SkillPolicy = {
  maxSkillBytes: 32_768,
  maxSelectedSkills: 8,
  maxSelectedInstructionBytes: 65_536,
  maxResourceReadBytes: 16_384,
  maxResourceBytes: 262_144,
  maxResourcesPerSkill: 200,
  maxResourceDepth: 8,
};

export const superpowersBundle = "superpowers";

export function parseQualifiedSkillId(
  id: unknown,
): { readonly prefix: string; readonly name: string } | undefined {
  if (typeof id !== "string") return undefined;
  const separator = id.indexOf(":");
  if (separator < 0) return undefined;
  const prefix = id.slice(0, separator);
  const name = id.slice(separator + 1);
  return isSkillName(prefix) && isSkillName(name)
    ? { prefix, name }
    : undefined;
}

/** Validate untrusted input (settings files, protocol payloads) into a partial selection. */
export function normalizeSkillSelection(
  value: unknown,
): Partial<SkillSelection> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Skill selection must be an object");
  const input = value as Record<string, unknown>;
  const result: {
    mode?: SkillSelection["mode"];
    superpowersEnabled?: boolean;
    skillIds?: readonly string[];
  } = {};
  if (input.mode !== undefined) {
    if (!skillModes.includes(input.mode as SkillSelection["mode"]))
      throw new Error(
        `Unknown skill mode ${JSON.stringify(input.mode)}; use automatic, manual or off`,
      );
    result.mode = input.mode as SkillSelection["mode"];
  }
  if (input.superpowersEnabled !== undefined) {
    if (typeof input.superpowersEnabled !== "boolean")
      throw new Error("superpowersEnabled must be true or false");
    result.superpowersEnabled = input.superpowersEnabled;
  }
  if (input.skillIds !== undefined) {
    if (!Array.isArray(input.skillIds) || input.skillIds.length > 64)
      throw new Error("skillIds must be a list of at most 64 skill IDs");
    for (const id of input.skillIds)
      if (!parseQualifiedSkillId(id))
        throw new Error(`Invalid skill ID: ${String(id).slice(0, 80)}`);
    result.skillIds = [...(input.skillIds as string[])];
  }
  return result;
}

/** Later layers win field by field; absent fields inherit. */
export function resolveSkillSelection(
  layers: readonly (Partial<SkillSelection> | undefined)[],
): SkillSelection {
  let selection = defaultSkillSelection;
  for (const layer of layers)
    if (layer)
      selection = {
        mode: layer.mode ?? selection.mode,
        superpowersEnabled:
          layer.superpowersEnabled ?? selection.superpowersEnabled,
        skillIds: layer.skillIds ?? selection.skillIds,
      };
  return { ...selection, skillIds: [...selection.skillIds] };
}

/**
 * Explains every reason a selection cannot run. Callers must surface these
 * messages instead of silently dropping or truncating skills.
 */
export function validateSkillSelection(
  selection: SkillSelection,
  available: readonly SkillMetadata[],
  policy: SkillPolicy = defaultSkillPolicy,
): string[] {
  if (!skillModes.includes(selection.mode))
    return [`Unknown skill mode ${JSON.stringify(selection.mode)}`];
  if (selection.mode === "off") return [];
  const problems: string[] = [];
  const byId = new Map(available.map((skill) => [skill.id, skill]));
  const unique = new Set<string>();
  let bytes = 0;
  for (const id of selection.skillIds) {
    if (unique.has(id)) {
      problems.push(`Skill ${id} is selected more than once.`);
      continue;
    }
    unique.add(id);
    const skill = byId.get(id);
    if (!skill) {
      problems.push(`Skill ${id} is not installed.`);
      continue;
    }
    if (!skill.trusted)
      problems.push(
        `Skill ${id} comes from the workspace and is untrusted; import it to use it.`,
      );
    else if (
      skill.bundle === superpowersBundle &&
      !selection.superpowersEnabled
    )
      problems.push(
        `Skill ${id} belongs to the Superpowers pack, which is disabled.`,
      );
    bytes += skill.instructionBytes;
  }
  if (unique.size > policy.maxSelectedSkills)
    problems.push(
      `${unique.size} skills selected; at most ${policy.maxSelectedSkills} can be active in one run.`,
    );
  else if (bytes > policy.maxSelectedInstructionBytes)
    problems.push(
      `Selected skill instructions total ${bytes} bytes; the limit is ${policy.maxSelectedInstructionBytes}.`,
    );
  return problems;
}
