import { createHash } from "node:crypto";
import type {
  LoadedSkill,
  SkillDiagnostic,
  SkillListing,
  SkillMetadata,
  SkillResourceChunk,
  SkillResourceRange,
  SkillSource,
  SkillSourceKind,
} from "./contracts.js";
import { resourceRange, skillResourcePath, utf8Chunk } from "./file-store.js";
import { isSkillName, parseSkillDocument } from "./frontmatter.js";
import { defaultSkillPolicy, type SkillPolicy } from "./policy.js";

export interface StaticSkillSourceOptions {
  readonly prefix: string;
  readonly source: SkillSourceKind;
  readonly trusted: boolean;
  readonly bundle?: string;
  /** Skill files keyed by `<skill>/<relative path>`, including `<skill>/SKILL.md`. */
  readonly files: Readonly<Record<string, string>>;
  readonly policy?: SkillPolicy;
}

/** Skills shipped as data inside the package; immutable for the process lifetime. */
export class StaticSkillSource implements SkillSource {
  readonly prefix: string;
  private readonly skills = new Map<string, LoadedSkill>();
  private readonly diagnostics: SkillDiagnostic[] = [];
  private readonly policy: SkillPolicy;

  constructor(private readonly options: StaticSkillSourceOptions) {
    if (!isSkillName(options.prefix))
      throw new Error(`Invalid skill source prefix: ${options.prefix}`);
    this.prefix = options.prefix;
    this.policy = options.policy ?? defaultSkillPolicy;
    const resources = new Map<string, string[]>();
    for (const path of Object.keys(options.files).sort()) {
      const [name = "", ...rest] = path.split("/");
      const relative = rest.join("/");
      if (relative === "SKILL.md") continue;
      if (!isSkillName(name)) continue;
      try {
        skillResourcePath(relative);
      } catch {
        continue;
      }
      resources.set(name, [...(resources.get(name) ?? []), relative]);
    }
    for (const path of Object.keys(options.files).sort()) {
      const [name = "", file] = path.split("/");
      if (file !== "SKILL.md" || path !== `${name}/SKILL.md`) continue;
      const id = `${this.prefix}:${name}`;
      const text = options.files[path] ?? "";
      try {
        if (!isSkillName(name)) throw new Error("Invalid skill name");
        if (Buffer.byteLength(text) > this.policy.maxSkillBytes)
          throw new Error(
            `SKILL.md exceeds ${this.policy.maxSkillBytes} bytes`,
          );
        const document = parseSkillDocument(text);
        if (document.name !== name)
          throw new Error(
            `Frontmatter name ${document.name} does not match directory ${name}`,
          );
        this.skills.set(name, {
          id,
          name,
          description: document.description,
          source: options.source,
          ...(options.bundle ? { bundle: options.bundle } : {}),
          trusted: options.trusted,
          resources: resources.get(name) ?? [],
          instructionBytes: Buffer.byteLength(document.body),
          sha256: createHash("sha256").update(text).digest("hex"),
          instructions: document.body,
        });
      } catch (error) {
        this.diagnostics.push({
          skillId: id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  async list(): Promise<SkillListing> {
    return {
      skills: [...this.skills.values()].map(
        ({ instructions: _instructions, ...metadata }): SkillMetadata =>
          metadata,
      ),
      diagnostics: [...this.diagnostics],
    };
  }

  async load(name: string): Promise<LoadedSkill | undefined> {
    return this.skills.get(name);
  }

  async readResource(
    name: string,
    path: string,
    range: SkillResourceRange = {},
  ): Promise<SkillResourceChunk> {
    const relative = skillResourcePath(path);
    const skill = this.skills.get(name);
    if (!skill) throw new Error(`Unknown skill ${this.prefix}:${name}`);
    if (!skill.resources.includes(relative))
      throw new Error(`Skill ${skill.id} has no resource ${relative}`);
    const { offset, limit } = resourceRange(range, this.policy);
    const bytes = Buffer.from(
      this.options.files[`${name}/${relative}`] ?? "",
      "utf8",
    );
    if (offset > bytes.length)
      throw new Error(
        `Offset ${offset} is beyond the end (${bytes.length} bytes)`,
      );
    const chunk = utf8Chunk(
      bytes.subarray(offset, offset + limit + 3),
      offset,
      limit,
      bytes.length,
    );
    return {
      skillId: skill.id,
      path: relative,
      content: chunk.content,
      offset: chunk.offset,
      totalBytes: chunk.totalBytes,
      ...(chunk.end < chunk.totalBytes ? { nextOffset: chunk.end } : {}),
    };
  }
}
