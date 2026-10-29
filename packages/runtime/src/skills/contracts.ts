/**
 * Skills are instruction bundles: a directory with SKILL.md plus optional text
 * resources. They change what an agent is told, never which tools it may use.
 */

export type SkillMode = "automatic" | "manual" | "off";
export const skillModes: readonly SkillMode[] = ["automatic", "manual", "off"];

/** Where a skill came from. IDs are qualified by source so none can shadow another. */
export type SkillSourceKind = "bundled" | "user" | "workspace";

export interface SkillDiagnostic {
  /** Qualified ID when the problem belongs to one skill. */
  readonly skillId?: string;
  readonly message: string;
}

export interface SkillMetadata {
  /** Source-qualified, e.g. `superpowers:brainstorming` or `user:release-notes`. */
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly source: SkillSourceKind;
  /** Bundle name for bundled skills, e.g. `superpowers`. */
  readonly bundle?: string;
  /** Repository-discovered skills stay untrusted until the user imports them. */
  readonly trusted: boolean;
  /** Supporting text resources, as skill-relative POSIX paths. */
  readonly resources: readonly string[];
  readonly instructionBytes: number;
  /** SHA-256 of SKILL.md, so a run snapshot can identify exactly what it used. */
  readonly sha256: string;
}

export interface LoadedSkill extends SkillMetadata {
  /** SKILL.md body without frontmatter. */
  readonly instructions: string;
}

export interface SkillSelection {
  readonly mode: SkillMode;
  /** The bundled Superpowers pack can be disabled independently of custom skills. */
  readonly superpowersEnabled: boolean;
  /** Explicitly selected qualified IDs; the only skills Manual mode loads. */
  readonly skillIds: readonly string[];
}

export const defaultSkillSelection: SkillSelection = {
  mode: "automatic",
  superpowersEnabled: true,
  skillIds: [],
};

export interface SkillResourceRange {
  readonly offset?: number;
  readonly limit?: number;
}

export interface SkillResourceChunk {
  readonly skillId: string;
  readonly path: string;
  readonly content: string;
  readonly offset: number;
  readonly totalBytes: number;
  /** Present when more content remains; pass it as the next offset. */
  readonly nextOffset?: number;
}

export interface SkillListing {
  readonly skills: readonly SkillMetadata[];
  readonly diagnostics: readonly SkillDiagnostic[];
}

export interface SkillRegistry {
  list(): Promise<SkillListing>;
  get(id: string): Promise<LoadedSkill | undefined>;
  readResource(
    id: string,
    path: string,
    range?: SkillResourceRange,
  ): Promise<SkillResourceChunk>;
}

/** One root of skills sharing an ID prefix; composed by a registry. */
export interface SkillSource {
  readonly prefix: string;
  list(): Promise<SkillListing>;
  load(name: string): Promise<LoadedSkill | undefined>;
  readResource(
    name: string,
    path: string,
    range?: SkillResourceRange,
  ): Promise<SkillResourceChunk>;
}

export type SkillImport =
  | {
      readonly kind: "directory";
      /** Explicit local path chosen by the user through a trusted host interaction. */
      readonly path: string;
      readonly replace?: boolean;
    }
  | {
      readonly kind: "content";
      /** Pasted SKILL.md text, including frontmatter. */
      readonly content: string;
      readonly resources?: readonly {
        readonly path: string;
        readonly content: string;
      }[];
      readonly replace?: boolean;
    };

/** Managed, user-owned skill storage. */
export interface SkillStore {
  import(input: SkillImport): Promise<SkillMetadata>;
  remove(id: string): Promise<void>;
}

/**
 * Settings scope. Omitted fields widen the scope: no workspace means the user
 * default; an agent or session is always inside a workspace.
 */
export interface SkillSettingsScope {
  readonly workspaceRoot?: string;
  readonly agentId?: string;
  readonly sessionId?: string;
}

export interface SkillSettingsStore {
  /** Effective selection after layering user, workspace, agent and session values. */
  getSettings(scope: SkillSettingsScope): Promise<SkillSelection>;
  /** Writes exactly the most specific level named by `scope`; undefined clears it. */
  setSettings(
    scope: SkillSettingsScope,
    selection: Partial<SkillSelection> | undefined,
  ): Promise<void>;
}
