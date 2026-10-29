import {
  type ResolvedConfiguration,
  resolveSkills,
} from "@truss-harness/cli/config";
import type { RuntimeServiceSkillState } from "@truss-harness/cli/protocol";
import { skillServiceHost } from "@truss-harness/cli/skills";
import type { SkillMode, SkillSelection } from "@truss-harness/runtime";
import { useCallback, useMemo, useRef, useState } from "react";

export type SkillScope = "user" | "workspace";
type DefaultSkills = ResolvedConfiguration["skills"];

const superpowersPrefix = "superpowers:";
const modes: readonly SkillMode[] = ["automatic", "manual", "off"];

export interface SkillPickerRow {
  readonly id: string;
  readonly description: string;
  readonly selected: boolean;
  readonly available: boolean;
  readonly note?: string;
}

export function skillPickerRows(
  state: RuntimeServiceSkillState,
): SkillPickerRow[] {
  const selected = new Set(state.selection.skillIds);
  return state.skills.map((skill) => {
    const packOff =
      skill.id.startsWith(superpowersPrefix) &&
      !state.selection.superpowersEnabled;
    const note = !skill.trusted
      ? "untrusted: import to use"
      : packOff
        ? "pack off"
        : undefined;
    return {
      id: skill.id,
      description: skill.description,
      selected: selected.has(skill.id),
      available: skill.trusted && !packOff,
      ...(note ? { note } : {}),
    };
  });
}

export function nextSkillMode(mode: SkillMode): SkillMode {
  return modes[(modes.indexOf(mode) + 1) % modes.length] ?? "automatic";
}

/** Space on a row: unavailable skills can be cleared but never added. */
export function toggledSkillSelection(
  state: RuntimeServiceSkillState,
  row: SkillPickerRow,
): Partial<SkillSelection> | undefined {
  if (!row.selected && !row.available) return undefined;
  const rest = state.selection.skillIds.filter((id) => id !== row.id);
  return { skillIds: row.selected ? rest : [...rest, row.id] };
}

/** Turning the pack off drops selected pack skills so runs stay valid. */
export function superpowersSelection(
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

/**
 * Keyboard skill picker state. Skills come from the same user store and
 * settings file as the CLI, so changes apply to every client's next run.
 */
export function useSkillsController(
  workspaceRoot: string,
  configured?: DefaultSkills,
) {
  const resolved = useRef<Promise<DefaultSkills> | undefined>(undefined);
  const skills = useCallback((): Promise<DefaultSkills> => {
    if (configured) return Promise.resolve(configured);
    resolved.current ??= resolveSkills({ workspaceRoot });
    return resolved.current;
  }, [configured, workspaceRoot]);
  const [skillState, setSkillState] = useState<RuntimeServiceSkillState>();
  const [skillIndex, setSkillIndex] = useState(0);
  const [skillScope, setSkillScope] = useState<SkillScope>("user");
  const [skillError, setSkillError] = useState<string>();

  const run = useCallback(
    (
      action: (
        host: ReturnType<typeof skillServiceHost>,
      ) => Promise<RuntimeServiceSkillState>,
    ) => {
      void skills()
        .then((value) => action(skillServiceHost(value, workspaceRoot)))
        .then((next) => {
          setSkillState(next);
          setSkillError(undefined);
          setSkillIndex((index) =>
            Math.min(index, Math.max(0, next.skills.length - 1)),
          );
        })
        .catch((error: unknown) =>
          setSkillError(error instanceof Error ? error.message : String(error)),
        );
    },
    [skills, workspaceRoot],
  );

  const actions = useMemo(() => {
    const save = (selection: Partial<SkillSelection> | undefined) => {
      if (selection)
        run((host) => host.setSettings(skillScope, undefined, selection));
    };
    return {
      refreshSkills: () => run((host) => host.list()),
      moveSkill: (delta: number) =>
        setSkillIndex((index) =>
          Math.min(
            Math.max(0, index + delta),
            Math.max(0, (skillState?.skills.length ?? 1) - 1),
          ),
        ),
      toggleSkill: () => {
        const row = skillState && skillPickerRows(skillState)[skillIndex];
        if (skillState && row) save(toggledSkillSelection(skillState, row));
      },
      cycleSkillMode: () => {
        if (skillState)
          save({ mode: nextSkillMode(skillState.selection.mode) });
      },
      toggleSuperpowers: () => {
        if (skillState) save(superpowersSelection(skillState.selection));
      },
      toggleSkillScope: () =>
        setSkillScope((scope) => (scope === "user" ? "workspace" : "user")),
    };
  }, [run, skillIndex, skillScope, skillState]);

  return {
    skills,
    skillState,
    skillIndex,
    skillScope,
    skillError,
    ...actions,
  };
}
