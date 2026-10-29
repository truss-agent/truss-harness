import type { DefaultSkills } from "@truss-harness/agent-host";
import { resolveSkills } from "@truss-harness/cli/config";
import { skillServiceHost } from "@truss-harness/cli/skills";
import type { SkillSelection } from "@truss-harness/runtime";
import type { DesktopSkillScope, DesktopSkillState } from "../shared.js";

export interface DesktopSkillServiceOptions {
  readonly workspaceRoot: () => string;
  /** Trusted main-process folder picker; the renderer never supplies paths. */
  readonly chooseDirectory: () => Promise<string | undefined>;
  readonly resolve?: (workspaceRoot: string) => Promise<DefaultSkills>;
}

/**
 * Desktop skills share the CLI's user store and settings file, so a skill
 * imported here is available in every client for the same user.
 */
export class DesktopSkillService {
  private cached: { root: string; skills: Promise<DefaultSkills> } | undefined;

  constructor(private readonly options: DesktopSkillServiceOptions) {}

  /** Skill wiring for runtimes created for the current workspace. */
  skills(): Promise<DefaultSkills> {
    const root = this.options.workspaceRoot();
    if (this.cached?.root !== root) {
      const resolve =
        this.options.resolve ??
        ((workspaceRoot: string) => resolveSkills({ workspaceRoot }));
      this.cached = { root, skills: resolve(root) };
      // A failed resolution must not be cached for the next attempt.
      this.cached.skills.catch(() => {
        if (this.cached?.root === root) this.cached = undefined;
      });
    }
    return this.cached.skills;
  }

  async list(): Promise<DesktopSkillState> {
    return (await this.service()).list();
  }

  async setSettings(
    scope: DesktopSkillScope,
    selection: Partial<SkillSelection> | null,
  ): Promise<DesktopSkillState> {
    return (await this.service()).setSettings(
      scope,
      undefined,
      selection ?? undefined,
    );
  }

  /** Imports a folder the user picked; resolves undefined when cancelled. */
  async importDirectory(): Promise<DesktopSkillState | undefined> {
    const path = await this.options.chooseDirectory();
    if (!path) return undefined;
    const service = await this.service();
    await service.import?.({ kind: "directory", path });
    return service.list();
  }

  async remove(id: string): Promise<DesktopSkillState> {
    const service = await this.service();
    await service.remove?.(id);
    return service.list();
  }

  private async service() {
    return skillServiceHost(await this.skills(), this.options.workspaceRoot());
  }
}
