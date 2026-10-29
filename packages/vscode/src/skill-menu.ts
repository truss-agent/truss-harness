import type { RuntimeServiceSkillState } from "@truss-harness/cli/protocol";
import type { SkillSelection } from "@truss-harness/runtime";

export type SkillScope = "user" | "workspace";
export type SkillMenuAction =
  | "scope"
  | "mode"
  | "superpowers"
  | "select"
  | "import"
  | "remove"
  | "reset";

export interface SkillMenuItem {
  readonly action: SkillMenuAction;
  readonly label: string;
  readonly description?: string;
  readonly detail?: string;
}

const superpowersPrefix = "superpowers:";
const modeLabels = {
  automatic: "Automatic",
  manual: "Manual",
  off: "Off",
} as const;

/** Skills that can be selected now: trusted, and not in a disabled pack. */
export function selectableSkills(state: RuntimeServiceSkillState) {
  return state.skills.filter(
    (skill) =>
      skill.trusted &&
      (state.selection.superpowersEnabled ||
        !skill.id.startsWith(superpowersPrefix)),
  );
}

/** Top-level Manage Skills menu; management entries need host support. */
export function skillMenuItems(
  state: RuntimeServiceSkillState,
  scope: SkillScope,
  manage: boolean,
): SkillMenuItem[] {
  const { mode, superpowersEnabled, skillIds } = state.selection;
  const untrusted = state.skills.filter((skill) => !skill.trusted).length;
  const items: SkillMenuItem[] = [
    {
      action: "scope",
      label: `Save changes for: ${scope === "user" ? "All workspaces" : "This workspace"}`,
      description: "Switch",
    },
    {
      action: "mode",
      label: `Mode: ${modeLabels[mode]}`,
      detail:
        mode === "automatic"
          ? "Agents load relevant skills on their own."
          : mode === "manual"
            ? "Only always-active skills run."
            : "No skills are used.",
    },
    {
      action: "superpowers",
      label: `Superpowers pack: ${superpowersEnabled ? "On" : "Off"}`,
      description: superpowersEnabled ? "Turn off" : "Turn on",
    },
    {
      action: "select",
      label: `Always-active skills (${skillIds.length})`,
      ...(skillIds.length ? { detail: skillIds.join(", ") } : {}),
    },
  ];
  if (manage)
    items.push(
      {
        action: "import",
        label: "Import skill folder...",
        ...(untrusted
          ? {
              detail: `${untrusted} repository skill${untrusted === 1 ? "" : "s"} must be imported before use.`,
            }
          : {}),
      },
      { action: "remove", label: "Remove one of your skills..." },
    );
  if (scope === "workspace")
    items.push({ action: "reset", label: "Clear this workspace's choices" });
  return items;
}

/** Turning the pack off drops selected pack skills so runs stay valid. */
export function superpowersToggle(
  selection: SkillSelection,
): Partial<SkillSelection> {
  return selection.superpowersEnabled
    ? {
        superpowersEnabled: false,
        skillIds: selection.skillIds.filter(
          (id) => !id.startsWith(superpowersPrefix),
        ),
      }
    : { superpowersEnabled: true };
}

export function skillStatusText(state: RuntimeServiceSkillState): string {
  const { mode, skillIds } = state.selection;
  return mode === "off"
    ? "Skills are off."
    : `${modeLabels[mode]} skills, ${skillIds.length} always active. Changes apply to the next run.`;
}
