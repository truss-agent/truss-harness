import type {
  LoadedSkill,
  SkillListing,
  SkillRegistry,
  SkillResourceChunk,
  SkillResourceRange,
  SkillSource,
} from "./contracts.js";
import { parseQualifiedSkillId } from "./policy.js";

/** Routes qualified IDs to their source; sources never shadow one another. */
export class CompositeSkillRegistry implements SkillRegistry {
  private readonly sources = new Map<string, SkillSource>();

  constructor(sources: readonly SkillSource[]) {
    for (const source of sources) {
      if (this.sources.has(source.prefix))
        throw new Error(`Duplicate skill source prefix: ${source.prefix}`);
      this.sources.set(source.prefix, source);
    }
  }

  async list(): Promise<SkillListing> {
    const listings = await Promise.all(
      [...this.sources.values()].map((source) => source.list()),
    );
    return {
      skills: listings.flatMap((listing) => listing.skills),
      diagnostics: listings.flatMap((listing) => listing.diagnostics),
    };
  }

  async get(id: string): Promise<LoadedSkill | undefined> {
    const parsed = parseQualifiedSkillId(id);
    if (!parsed) return undefined;
    return this.sources.get(parsed.prefix)?.load(parsed.name);
  }

  async readResource(
    id: string,
    path: string,
    range?: SkillResourceRange,
  ): Promise<SkillResourceChunk> {
    const parsed = parseQualifiedSkillId(id);
    const source = parsed && this.sources.get(parsed.prefix);
    if (!parsed || !source) throw new Error(`Unknown skill ${id}`);
    return source.readResource(parsed.name, path, range);
  }
}
