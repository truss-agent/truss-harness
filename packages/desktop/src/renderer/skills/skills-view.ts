import type { SkillSelection } from "@truss-harness/runtime";
import type { DesktopSkillState } from "../../shared.js";

const superpowersBundle = "superpowers";

export interface DesktopSkillRow {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly origin: string;
  /** Selected skills are active for every run, in Automatic and Manual mode. */
  readonly selected: boolean;
  /** Whether the skill can be selected or loaded right now. */
  readonly available: boolean;
  readonly removable: boolean;
  readonly note?: string;
}

/** Display rows for the settings list, with why a skill cannot be used. */
export function skillRows(state: DesktopSkillState): DesktopSkillRow[] {
  const selected = new Set(state.selection.skillIds);
  return state.skills.map((skill) => {
    const packOff =
      skill.bundle === superpowersBundle && !state.selection.superpowersEnabled;
    const note = !skill.trusted
      ? "Found in this repository. Import the folder to trust and use it."
      : packOff
        ? "Superpowers is off."
        : undefined;
    return {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      origin:
        skill.source === "bundled"
          ? (skill.bundle ?? "bundled")
          : skill.source === "user"
            ? "yours"
            : "repository",
      selected: selected.has(skill.id),
      available: skill.trusted && !packOff,
      removable: skill.source === "user",
      ...(note ? { note } : {}),
    };
  });
}

/** Selection change for one checkbox, keeping the list unique and ordered. */
export function toggledSkillIds(
  selection: SkillSelection,
  id: string,
  selected: boolean,
): string[] {
  const rest = selection.skillIds.filter((skillId) => skillId !== id);
  return selected ? [...rest, id] : rest;
}

/**
 * Turning the pack off also drops selected pack skills, which would otherwise
 * make every run fail validation until they were deselected one by one.
 */
export function superpowersChange(
  selection: SkillSelection,
  enabled: boolean,
): Partial<SkillSelection> {
  return enabled
    ? { superpowersEnabled: true }
    : {
        superpowersEnabled: false,
        skillIds: selection.skillIds.filter(
          (id) => !id.startsWith(`${superpowersBundle}:`),
        ),
      };
}

export function skillSummary(state: DesktopSkillState): string {
  const { mode, skillIds } = state.selection;
  const usable = skillRows(state).filter((row) => row.available).length;
  const description =
    mode === "off"
      ? "Skills are off."
      : mode === "manual"
        ? `Manual: only the ${skillIds.length} selected skill${skillIds.length === 1 ? "" : "s"} run.`
        : `Automatic: agents choose from ${usable} skill${usable === 1 ? "" : "s"}${skillIds.length ? `; ${skillIds.length} always active` : ""}.`;
  return `${description} Changes apply to the next run.`;
}
