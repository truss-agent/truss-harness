import { createHash, randomUUID } from "node:crypto";
import { constants, type Dirent } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { readBoundedText } from "../resource-limits.js";
import {
  FileWorkspaceStorageOwnership,
  type WorkspaceStorageOwnership,
} from "../storage-ownership.js";
import type {
  LoadedSkill,
  SkillDiagnostic,
  SkillImport,
  SkillListing,
  SkillMetadata,
  SkillResourceChunk,
  SkillResourceRange,
  SkillSelection,
  SkillSettingsScope,
  SkillSettingsStore,
  SkillSource,
  SkillSourceKind,
  SkillStore,
} from "./contracts.js";
import { isSkillName, parseSkillDocument } from "./frontmatter.js";
import {
  defaultSkillPolicy,
  normalizeSkillSelection,
  parseQualifiedSkillId,
  resolveSkillSelection,
  type SkillPolicy,
} from "./policy.js";

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
function contained(root: string, target: string): boolean {
  const path = relative(root, target);
  return (
    path !== "" &&
    !path.startsWith(`..${sep}`) &&
    path !== ".." &&
    !isAbsolute(path)
  );
}
/** Hidden entries may hold credentials or VCS data; dependencies are never skill content. */
function skippedEntry(name: string): boolean {
  return name.startsWith(".") || name === "node_modules";
}

/** Normalize a skill-relative resource path, rejecting anything that could leave the skill. */
export function skillResourcePath(path: unknown): string {
  if (typeof path !== "string" || !path || path.length > 512)
    throw new Error("Skill resource path must be a non-empty relative path");
  if (path.includes("\\") || path.includes("\0") || isAbsolute(path))
    throw new Error("Skill resource path must be relative and use /");
  const segments = path.split("/");
  if (
    segments.some(
      (segment) => !segment || segment === ".." || segment.startsWith("."),
    )
  )
    throw new Error(`Skill resource path is not allowed: ${path}`);
  if (path === "SKILL.md")
    throw new Error("SKILL.md is loaded as the skill itself, not a resource");
  return path;
}

/** Walk visible regular files without following symlinks. */
async function walk(
  directory: string,
  policy: SkillPolicy,
  onSymlink: (path: string) => void,
): Promise<string[]> {
  const files: string[] = [];
  const visit = async (current: string, depth: number) => {
    let entries: Dirent[];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (hasCode(error, "ENOENT")) return;
      throw error;
    }
    entries.sort((left, right) => (left.name < right.name ? -1 : 1));
    for (const entry of entries) {
      if (skippedEntry(entry.name)) continue;
      const path = join(current, entry.name);
      const relativePath = relative(directory, path).split(sep).join("/");
      if (entry.isSymbolicLink()) onSymlink(relativePath);
      else if (entry.isDirectory()) {
        if (depth < policy.maxResourceDepth) await visit(path, depth + 1);
      } else if (entry.isFile() && relativePath !== "SKILL.md") {
        files.push(relativePath);
        if (files.length > policy.maxResourcesPerSkill)
          throw new Error(
            `Skill has more than ${policy.maxResourcesPerSkill} resource files`,
          );
      }
    }
  };
  await visit(directory, 0);
  return files.sort();
}

/** Drop a trailing partial UTF-8 sequence. */
function completeUtf8(buffer: Buffer): Buffer {
  for (let back = 1; back <= Math.min(3, buffer.length); back++) {
    const byte = buffer[buffer.length - back] ?? 0;
    if ((byte & 0xc0) === 0x80) continue;
    const length = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1;
    return length > back ? buffer.subarray(0, buffer.length - back) : buffer;
  }
  return buffer;
}

/** Validate a requested resource range, capping the limit at the policy chunk size. */
export function resourceRange(
  range: SkillResourceRange,
  policy: SkillPolicy,
): { readonly offset: number; readonly limit: number } {
  const offset = range.offset ?? 0;
  const limit = Math.min(
    range.limit ?? policy.maxResourceReadBytes,
    policy.maxResourceReadBytes,
  );
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw new Error("Resource offset must be a non-negative integer");
  if (!Number.isSafeInteger(limit) || limit < 4)
    throw new Error("Resource limit must be an integer of at least 4");
  return { offset, limit };
}

export interface Utf8Chunk {
  readonly content: string;
  readonly offset: number;
  readonly totalBytes: number;
  readonly end: number;
}

/**
 * Cut whole characters from `window`, which starts at byte `offset` and holds
 * up to `limit + 3` bytes, so a start inside a code point can advance.
 */
export function utf8Chunk(
  window: Buffer,
  offset: number,
  limit: number,
  totalBytes: number,
): Utf8Chunk {
  let skip = 0;
  while (
    skip < Math.min(3, window.length) &&
    ((window[skip] ?? 0) & 0xc0) === 0x80
  )
    skip++;
  const bytes = window.subarray(skip, Math.min(window.length, skip + limit));
  const atEnd = offset + skip + bytes.length >= totalBytes;
  const complete = atEnd ? bytes : completeUtf8(bytes);
  return {
    content: complete.toString("utf8"),
    offset: offset + skip,
    totalBytes,
    end: offset + skip + complete.length,
  };
}

async function readChunk(
  path: string,
  offset: number,
  limit: number,
): Promise<Utf8Chunk> {
  // POSIX FIFO open must not block before the regular-file check.
  const flags =
    process.platform === "win32"
      ? constants.O_RDONLY
      : constants.O_RDONLY | constants.O_NONBLOCK;
  const file = await open(path, flags);
  try {
    const info = await file.stat();
    if (!info.isFile())
      throw new Error("Skill resources must be regular files");
    const totalBytes = info.size;
    if (offset > totalBytes)
      throw new Error(
        `Offset ${offset} is beyond the end (${totalBytes} bytes)`,
      );
    // Read three spare bytes so a start inside a code point can advance to the next one.
    const buffer = Buffer.alloc(Math.min(limit + 3, totalBytes - offset));
    let read = 0;
    while (read < buffer.length) {
      const { bytesRead } = await file.read(
        buffer,
        read,
        buffer.length - read,
        offset + read,
      );
      if (!bytesRead) break;
      read += bytesRead;
    }
    return utf8Chunk(buffer.subarray(0, read), offset, limit, totalBytes);
  } finally {
    await file.close();
  }
}

export interface FileSkillSourceOptions {
  readonly root: string;
  readonly source: SkillSourceKind;
  /** ID prefix, e.g. `user`, `workspace` or a bundle name. */
  readonly prefix: string;
  readonly trusted: boolean;
  readonly bundle?: string;
  readonly policy?: SkillPolicy;
}

type Inspection =
  | { readonly skill: LoadedSkill; readonly directory: string }
  | { readonly diagnostic: SkillDiagnostic };

/** Discovers `<root>/<name>/SKILL.md` skills. Diagnostics never include host paths. */
export class FileSkillSource implements SkillSource {
  readonly prefix: string;
  private readonly policy: SkillPolicy;

  constructor(private readonly options: FileSkillSourceOptions) {
    if (!isSkillName(options.prefix))
      throw new Error(`Invalid skill source prefix: ${options.prefix}`);
    this.prefix = options.prefix;
    this.policy = options.policy ?? defaultSkillPolicy;
  }

  async list(): Promise<SkillListing> {
    let entries: Dirent[];
    try {
      entries = await readdir(this.options.root, { withFileTypes: true });
    } catch (error) {
      if (hasCode(error, "ENOENT")) return { skills: [], diagnostics: [] };
      throw error;
    }
    const names = entries
      .filter(
        (entry) =>
          !skippedEntry(entry.name) &&
          (entry.isDirectory() || entry.isSymbolicLink()),
      )
      .map((entry) => entry.name)
      .sort();
    const skills: SkillMetadata[] = [];
    const diagnostics: SkillDiagnostic[] = [];
    for (const name of names) {
      const result = await this.inspect(name);
      if ("diagnostic" in result) diagnostics.push(result.diagnostic);
      else {
        const { instructions: _instructions, ...metadata } = result.skill;
        skills.push(metadata);
      }
    }
    return { skills, diagnostics };
  }

  async load(name: string): Promise<LoadedSkill | undefined> {
    if (!isSkillName(name)) return undefined;
    const result = await this.inspect(name);
    return "skill" in result ? result.skill : undefined;
  }

  async readResource(
    name: string,
    path: string,
    range: SkillResourceRange = {},
  ): Promise<SkillResourceChunk> {
    const relativePath = skillResourcePath(path);
    if (!isSkillName(name))
      throw new Error(`Unknown skill ${this.prefix}:${name}`);
    const result = await this.inspect(name);
    if (!("skill" in result))
      throw new Error(`Unknown skill ${this.prefix}:${name}`);
    if (!result.skill.resources.includes(relativePath))
      throw new Error(
        `Skill ${result.skill.id} has no resource ${relativePath}`,
      );
    const { offset, limit } = resourceRange(range, this.policy);
    const target = join(result.directory, ...relativePath.split("/"));
    // Recheck canonically at read time; listing excluded symlinks already.
    if (!contained(result.directory, await realpath(target)))
      throw new Error(`Skill resource escapes its skill: ${relativePath}`);
    const chunk = await readChunk(target, offset, limit);
    return {
      skillId: result.skill.id,
      path: relativePath,
      content: chunk.content,
      offset: chunk.offset,
      totalBytes: chunk.totalBytes,
      ...(chunk.end < chunk.totalBytes ? { nextOffset: chunk.end } : {}),
    };
  }

  private async inspect(name: string): Promise<Inspection> {
    const id = `${this.prefix}:${name}`;
    const fail = (message: string): Inspection => ({
      diagnostic: { skillId: isSkillName(name) ? id : undefined, message },
    });
    if (!isSkillName(name))
      return fail(
        `Skill directory ${JSON.stringify(name)} is not a valid skill name`,
      );
    let directory: string;
    try {
      const root = await realpath(this.options.root);
      directory = await realpath(join(this.options.root, name));
      if (!contained(root, directory) || !(await stat(directory)).isDirectory())
        return fail("Skill directory escapes the skill root");
    } catch (error) {
      if (hasCode(error, "ENOENT"))
        return fail("Skill directory is missing or a dangling link");
      throw error;
    }
    const skillPath = join(directory, "SKILL.md");
    try {
      if (!(await lstat(skillPath)).isFile())
        return fail("SKILL.md must be a regular file");
    } catch (error) {
      if (hasCode(error, "ENOENT")) return fail("Skill has no SKILL.md");
      throw error;
    }
    const { text, truncated } = await readBoundedText(
      skillPath,
      this.policy.maxSkillBytes,
    );
    if (truncated)
      return fail(`SKILL.md exceeds ${this.policy.maxSkillBytes} bytes`);
    let document: ReturnType<typeof parseSkillDocument>;
    try {
      document = parseSkillDocument(text);
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
    if (document.name !== name)
      return fail(
        `Frontmatter name ${document.name} does not match directory ${name}`,
      );
    let resources: string[];
    try {
      resources = await walk(directory, this.policy, () => undefined);
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
    return {
      directory,
      skill: {
        id,
        name,
        description: document.description,
        source: this.options.source,
        ...(this.options.bundle ? { bundle: this.options.bundle } : {}),
        trusted: this.options.trusted,
        resources,
        instructionBytes: Buffer.byteLength(document.body),
        sha256: createHash("sha256").update(text).digest("hex"),
        instructions: document.body,
      },
    };
  }
}

interface PreparedSkill {
  readonly name: string;
  readonly skill: string;
  readonly resources: readonly {
    readonly path: string;
    readonly content: Buffer;
  }[];
}

export interface FileSkillStoreOptions {
  /** Managed, user-owned skill directory, e.g. `<config root>/skills`. */
  readonly root: string;
  readonly prefix?: string;
  readonly policy?: SkillPolicy;
  readonly ownership?: WorkspaceStorageOwnership;
}

/** Copies explicitly chosen skills into managed storage; never links to the original. */
export class FileSkillStore implements SkillStore {
  private readonly policy: SkillPolicy;
  private readonly prefix: string;
  private readonly ownership: WorkspaceStorageOwnership;
  private readonly source: FileSkillSource;

  constructor(private readonly options: FileSkillStoreOptions) {
    this.policy = options.policy ?? defaultSkillPolicy;
    this.prefix = options.prefix ?? "user";
    this.ownership = options.ownership ?? new FileWorkspaceStorageOwnership();
    this.source = new FileSkillSource({
      root: options.root,
      source: "user",
      prefix: this.prefix,
      trusted: true,
      policy: this.policy,
    });
  }

  async import(input: SkillImport): Promise<SkillMetadata> {
    const prepared =
      input.kind === "directory"
        ? await this.prepareDirectory(input.path)
        : this.prepareContent(input.content, input.resources ?? []);
    const root = this.options.root;
    await this.ownership.run(join(root, ".skills"), async () => {
      const target = join(root, prepared.name);
      const exists = await lstat(target).then(
        () => true,
        (error: unknown) => {
          if (hasCode(error, "ENOENT")) return false;
          throw error;
        },
      );
      if (exists && !input.replace)
        throw new Error(`Skill ${this.prefix}:${prepared.name} already exists`);
      const staging = join(root, `.import-${randomUUID()}`);
      const retired = join(root, `.removed-${randomUUID()}`);
      try {
        await mkdir(staging, { recursive: true });
        await writeFile(join(staging, "SKILL.md"), prepared.skill, {
          flag: "wx",
        });
        for (const resource of prepared.resources) {
          const path = join(staging, ...resource.path.split("/"));
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, resource.content, { flag: "wx" });
        }
        if (exists) await rename(target, retired);
        await rename(staging, target);
      } finally {
        await rm(staging, { recursive: true, force: true });
        await rm(retired, { recursive: true, force: true });
      }
    });
    const imported = await this.source.load(prepared.name);
    if (!imported) throw new Error("Imported skill could not be read back");
    const { instructions: _instructions, ...metadata } = imported;
    return metadata;
  }

  async remove(id: string): Promise<void> {
    const parsed = parseQualifiedSkillId(id);
    if (!parsed) throw new Error(`Invalid skill ID: ${id}`);
    if (parsed.prefix !== this.prefix)
      throw new Error(
        `Only user skills can be removed; ${id} is managed by its source`,
      );
    const root = this.options.root;
    await this.ownership.run(join(root, ".skills"), async () => {
      const target = join(root, parsed.name);
      try {
        if (!(await lstat(target)).isDirectory())
          throw new Error(`Skill ${id} is not a managed skill directory`);
      } catch (error) {
        if (hasCode(error, "ENOENT")) throw new Error(`Skill ${id} not found`);
        throw error;
      }
      const retired = join(root, `.removed-${randomUUID()}`);
      await rename(target, retired);
      await rm(retired, { recursive: true, force: true });
    });
  }

  private checkSkill(text: string): string {
    if (Buffer.byteLength(text) > this.policy.maxSkillBytes)
      throw new Error(`SKILL.md exceeds ${this.policy.maxSkillBytes} bytes`);
    return parseSkillDocument(text).name;
  }

  private checkResource(path: string, content: Buffer): void {
    if (content.length > this.policy.maxResourceBytes)
      throw new Error(
        `Resource ${path} exceeds ${this.policy.maxResourceBytes} bytes`,
      );
    if (content.includes(0))
      throw new Error(`Resource ${path} is binary; skills contain text only`);
  }

  private prepareContent(
    content: string,
    resources: readonly { readonly path: string; readonly content: string }[],
  ): PreparedSkill {
    const name = this.checkSkill(content);
    if (resources.length > this.policy.maxResourcesPerSkill)
      throw new Error(
        `Skill has more than ${this.policy.maxResourcesPerSkill} resource files`,
      );
    const seen = new Set<string>();
    const prepared = resources.map((resource) => {
      const path = skillResourcePath(resource.path);
      if (path.split("/").length > this.policy.maxResourceDepth + 1)
        throw new Error(`Resource path ${path} is nested too deeply`);
      if (seen.has(path.toLowerCase()))
        throw new Error(`Resource path ${path} appears more than once`);
      seen.add(path.toLowerCase());
      const bytes = Buffer.from(resource.content, "utf8");
      this.checkResource(path, bytes);
      return { path, content: bytes };
    });
    return { name, skill: content, resources: prepared };
  }

  private async prepareDirectory(path: string): Promise<PreparedSkill> {
    if (!isAbsolute(path))
      throw new Error("Skill import path must be absolute");
    const directory = await realpath(path);
    if (!(await stat(directory)).isDirectory())
      throw new Error("Skill import path must be a directory");
    const skillPath = join(directory, "SKILL.md");
    if (!(await lstat(skillPath)).isFile())
      throw new Error("Skill import needs a regular SKILL.md file");
    const { text, truncated } = await readBoundedText(
      skillPath,
      this.policy.maxSkillBytes,
    );
    if (truncated)
      throw new Error(`SKILL.md exceeds ${this.policy.maxSkillBytes} bytes`);
    const name = this.checkSkill(text);
    const symlinks: string[] = [];
    const files = await walk(directory, this.policy, (link) =>
      symlinks.push(link),
    );
    if (symlinks.length)
      throw new Error(
        `Skill imports cannot contain symlinks: ${symlinks.slice(0, 5).join(", ")}`,
      );
    const resources: { path: string; content: Buffer }[] = [];
    for (const file of files) {
      const { text: content, truncated: tooLarge } = await readBoundedText(
        join(directory, ...file.split("/")),
        this.policy.maxResourceBytes,
      );
      const bytes = Buffer.from(content, "utf8");
      if (tooLarge)
        throw new Error(
          `Resource ${file} exceeds ${this.policy.maxResourceBytes} bytes`,
        );
      this.checkResource(file, bytes);
      resources.push({ path: file, content: bytes });
    }
    return { name, skill: text, resources };
  }
}

const settingsVersion = 1;
type SettingsRecords = Record<string, Partial<SkillSelection>>;

export interface FileSkillSettingsStoreOptions {
  /** User-owned file, e.g. `<config root>/skill-settings.json`. */
  readonly path: string;
  readonly ownership?: WorkspaceStorageOwnership;
}

/** Persists layered selections keyed by canonical workspace, never by UI identity. */
export class FileSkillSettingsStore implements SkillSettingsStore {
  private readonly ownership: WorkspaceStorageOwnership;

  constructor(private readonly options: FileSkillSettingsStoreOptions) {
    this.ownership = options.ownership ?? new FileWorkspaceStorageOwnership();
  }

  async getSettings(scope: SkillSettingsScope): Promise<SkillSelection> {
    const keys = await this.keys(scope);
    const records = await this.records();
    return resolveSkillSelection(keys.map((key) => records[key]));
  }

  async setSettings(
    scope: SkillSettingsScope,
    selection: Partial<SkillSelection> | undefined,
  ): Promise<void> {
    const value =
      selection === undefined ? undefined : normalizeSkillSelection(selection);
    const key = (await this.keys(scope)).at(-1) ?? "user";
    await this.ownership.run(this.options.path, async () => {
      const records = await this.records();
      if (!value || !Object.keys(value).length) delete records[key];
      else records[key] = value;
      await mkdir(dirname(this.options.path), { recursive: true });
      const temporary = `${this.options.path}.${randomUUID()}.tmp`;
      try {
        await writeFile(
          temporary,
          `${JSON.stringify({ version: settingsVersion, scopes: records }, null, 2)}\n`,
          { encoding: "utf8", mode: 0o600 },
        );
        await rename(temporary, this.options.path);
      } finally {
        await rm(temporary, { force: true });
      }
    });
  }

  /** Layer keys from widest to most specific. */
  private async keys(scope: SkillSettingsScope): Promise<string[]> {
    for (const [label, value] of [
      ["agentId", scope.agentId],
      ["sessionId", scope.sessionId],
    ] as const)
      if (
        value !== undefined &&
        (typeof value !== "string" || !value || value.length > 256)
      )
        throw new Error(`Skill settings ${label} must be a non-empty string`);
    if (scope.workspaceRoot === undefined) {
      if (scope.agentId !== undefined || scope.sessionId !== undefined)
        throw new Error(
          "Agent and session skill settings need a workspace scope",
        );
      return ["user"];
    }
    const workspace = `workspace:${createHash("sha256")
      .update(await realpath(scope.workspaceRoot))
      .digest("hex")}`;
    const keys = ["user", workspace];
    if (scope.agentId !== undefined)
      keys.push(`${workspace}:agent:${scope.agentId}`);
    if (scope.sessionId !== undefined)
      keys.push(`${workspace}:session:${scope.sessionId}`);
    return keys;
  }

  private async records(): Promise<SettingsRecords> {
    let text: string;
    try {
      text = await readFile(this.options.path, "utf8");
    } catch (error) {
      if (hasCode(error, "ENOENT")) return {};
      throw error;
    }
    try {
      const value = JSON.parse(text) as { version?: unknown; scopes?: unknown };
      if (
        value?.version !== settingsVersion ||
        !value.scopes ||
        typeof value.scopes !== "object" ||
        Array.isArray(value.scopes)
      )
        throw new Error("unsupported format");
      const records: SettingsRecords = Object.create(null);
      for (const [key, selection] of Object.entries(value.scopes))
        records[key] = normalizeSkillSelection(selection);
      return records;
    } catch (error) {
      throw new Error(`Unable to read skill settings at ${this.options.path}`, {
        cause: error,
      });
    }
  }
}
