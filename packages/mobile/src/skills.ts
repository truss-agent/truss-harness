import type {
  GatewayCommandResult,
  RemoteSkill,
  RemoteSkillState,
  SkillMode,
  SkillSelection,
  Workspace,
} from "./contracts";

/** Phones save skill choices for the paired workspace or one conversation. */
export type MobileSkillScope = "workspace" | "session";

type Command = (
  body: Record<string, unknown>,
  version?: number,
) => Promise<GatewayCommandResult>;

const superpowersPrefix = "superpowers:";

export const skillModeCopy: Record<
  SkillMode,
  { readonly title: string; readonly detail: string }
> = {
  automatic: { title: "Automatic", detail: "Agent picks" },
  manual: { title: "Manual", detail: "Selected only" },
  off: { title: "Off", detail: "No skills" },
};

/** Skill commands are protocol version 2 and need host support. */
export function supportsSkills(workspace: Workspace | undefined): boolean {
  return Boolean(
    workspace?.capabilities.supportsSkills &&
      workspace.capabilities.protocolVersions?.includes(2),
  );
}

function skillState(result: GatewayCommandResult): RemoteSkillState {
  if (result.type !== "skills_listed" || !result.skills || !result.selection)
    throw new Error("The paired host did not return skills.");
  return { skills: result.skills, selection: result.selection };
}

export async function listRemoteSkills(
  command: Command,
  workspaceId: string,
  sessionId?: string,
): Promise<RemoteSkillState> {
  return skillState(
    await command(
      {
        type: "list_skills",
        workspaceId,
        ...(sessionId ? { sessionId } : {}),
      },
      2,
    ),
  );
}

export async function updateRemoteSkills(
  command: Command,
  workspaceId: string,
  scope: MobileSkillScope,
  sessionId: string | undefined,
  selection: Partial<SkillSelection> | null,
): Promise<RemoteSkillState> {
  if (scope === "session" && !sessionId)
    throw new Error("Open a conversation to save skills for it.");
  return skillState(
    await command(
      {
        type: "update_skill_settings",
        workspaceId,
        scope,
        ...(sessionId ? { sessionId } : {}),
        selection,
      },
      2,
    ),
  );
}

export function skillAvailable(
  state: RemoteSkillState,
  skill: RemoteSkill,
): boolean {
  return (
    skill.trusted &&
    (state.selection.superpowersEnabled ||
      !skill.id.startsWith(superpowersPrefix))
  );
}

/** Unavailable skills can be cleared but never added. */
export function toggledSkill(
  state: RemoteSkillState,
  skill: RemoteSkill,
): Partial<SkillSelection> | undefined {
  const selected = state.selection.skillIds.includes(skill.id);
  if (!selected && !skillAvailable(state, skill)) return undefined;
  const rest = state.selection.skillIds.filter((id) => id !== skill.id);
  return { skillIds: selected ? rest : [...rest, skill.id] };
}

/** Turning the pack off drops selected pack skills so runs stay valid. */
export function toggledSuperpowers(
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
