import { join } from "node:path";
import {
  type AgentProfile,
  CompositeSkillRegistry,
  createSuperpowersSkillSource,
  FileSkillSettingsStore,
  FileSkillSource,
  FileSkillStore,
  resolveSkillSelection,
  resolveWorkspacePath,
  type SkillPolicy,
  type SkillRegistry,
  type SkillSelection,
  type SkillSource,
} from "@truss-harness/runtime";

/** Skill wiring for an AgentHost. Text-only helper runtimes never receive skills. */
export interface AgentHostSkills {
  readonly registry: SkillRegistry;
  /** Effective selection for one run of `profile` in `sessionId`. */
  selection(target: {
    readonly profile: AgentProfile;
    readonly sessionId: string;
  }): SkillSelection | Promise<SkillSelection>;
  readonly policy?: SkillPolicy;
}

export interface DefaultSkillsOptions {
  readonly workspaceRoot: string;
  /** User-owned product config directory; holds `skills/` and `skill-settings.json`. */
  readonly userConfigDirectory: string;
  /** Explicit overrides (command-line flags, environment) that outrank stored settings. */
  readonly overrides?: Partial<SkillSelection>;
  readonly policy?: SkillPolicy;
}

export interface DefaultSkills extends AgentHostSkills {
  readonly store: FileSkillStore;
  readonly settings: FileSkillSettingsStore;
}

/**
 * Bundled Superpowers, the user's managed skills, and untrusted workspace
 * skills under `.truss-harness/skills` that the user can review and import.
 */
export function createDefaultSkills(
  options: DefaultSkillsOptions,
): DefaultSkills {
  const userSkills = join(options.userConfigDirectory, "skills");
  const sources: SkillSource[] = [
    createSuperpowersSkillSource(),
    new FileSkillSource({
      root: userSkills,
      source: "user",
      prefix: "user",
      trusted: true,
      policy: options.policy,
    }),
  ];
  try {
    sources.push(
      new FileSkillSource({
        root: resolveWorkspacePath(
          options.workspaceRoot,
          ".truss-harness/skills",
        ),
        source: "workspace",
        prefix: "workspace",
        trusted: false,
        policy: options.policy,
      }),
    );
  } catch {
    // A workspace skills path that escapes the workspace is simply not discovered.
  }
  const settings = new FileSkillSettingsStore({
    path: join(options.userConfigDirectory, "skill-settings.json"),
  });
  return {
    registry: new CompositeSkillRegistry(sources),
    store: new FileSkillStore({ root: userSkills, policy: options.policy }),
    settings,
    ...(options.policy ? { policy: options.policy } : {}),
    selection: async ({ profile, sessionId }) =>
      resolveSkillSelection([
        await settings.getSettings({
          workspaceRoot: options.workspaceRoot,
          agentId: profile.id,
          sessionId,
        }),
        options.overrides,
      ]),
  };
}
