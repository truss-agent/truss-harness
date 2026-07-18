import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { brand } from "@truss-harness/branding";

export type WorkspaceTaskStatus = "running" | "completed" | "failed";

export interface WorkspaceToolRecord {
  readonly name: string;
  readonly succeeded: boolean;
}

export interface WorkspaceTaskRecord {
  readonly id: string;
  readonly sessionId: string;
  readonly objective: string;
  readonly status: WorkspaceTaskStatus;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly assistantSummary?: string;
  readonly error?: string;
  readonly tools: readonly WorkspaceToolRecord[];
  readonly modifiedFiles: readonly string[];
}

/** Bounded repository state captured by an explicit workspace update. */
export interface WorkspaceRepositoryState {
  readonly updatedAt: string;
  readonly branch?: string;
  readonly changedFiles: readonly string[];
  readonly summary?: string;
}

export interface WorkspaceMemorySnapshot {
  readonly version: 1;
  readonly updatedAt: string;
  readonly tasks: readonly WorkspaceTaskRecord[];
  readonly recentlyModifiedFiles: readonly { readonly path: string; readonly updatedAt: string }[];
  readonly repository?: WorkspaceRepositoryState;
}

export interface WorkspaceMemoryStore {
  load(): Promise<WorkspaceMemorySnapshot>;
  upsertTask(task: WorkspaceTaskRecord): Promise<void>;
  updateRepositoryState(state: WorkspaceRepositoryState): Promise<void>;
  clear(): Promise<void>;
}

export function emptyWorkspaceMemorySnapshot(): WorkspaceMemorySnapshot {
  return { version: 1, updatedAt: new Date(0).toISOString(), tasks: [], recentlyModifiedFiles: [] };
}

function isTask(value: unknown): value is WorkspaceTaskRecord {
  if (!value || typeof value !== "object") return false;
  const task = value as Partial<WorkspaceTaskRecord>;
  return typeof task.id === "string" && typeof task.sessionId === "string" && typeof task.objective === "string"
    && (task.status === "running" || task.status === "completed" || task.status === "failed") && typeof task.startedAt === "string";
}

function isRepositoryState(value: unknown): value is WorkspaceRepositoryState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<WorkspaceRepositoryState>;
  return typeof state.updatedAt === "string" && Array.isArray(state.changedFiles) && state.changedFiles.every((path) => typeof path === "string")
    && (state.branch === undefined || typeof state.branch === "string") && (state.summary === undefined || typeof state.summary === "string");
}

function normalizeSnapshot(value: unknown): WorkspaceMemorySnapshot {
  if (!value || typeof value !== "object") return emptyWorkspaceMemorySnapshot();
  const source = value as Partial<WorkspaceMemorySnapshot>;
  const tasks = Array.isArray(source.tasks) ? source.tasks.filter(isTask) : [];
  const recentlyModifiedFiles = Array.isArray(source.recentlyModifiedFiles)
    ? source.recentlyModifiedFiles.filter((entry): entry is { path: string; updatedAt: string } => Boolean(entry) && typeof entry.path === "string" && typeof entry.updatedAt === "string")
    : [];
  return {
    version: 1,
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : new Date(0).toISOString(),
    tasks,
    recentlyModifiedFiles,
    repository: isRepositoryState(source.repository) ? source.repository : undefined
  };
}

/** Durable, workspace-local memory stored outside normal source directories. */
export class FileWorkspaceMemoryStore implements WorkspaceMemoryStore {
  private pendingWrite: Promise<void> = Promise.resolve();
  readonly path: string;

  constructor(workspaceRoot: string, options: { readonly path?: string; readonly maxTasks?: number; readonly maxFiles?: number } = {}) {
    this.path = options.path ?? join(workspaceRoot, brand.workspaceDirectory, "agent-state.json");
    this.maxTasks = options.maxTasks ?? 30;
    this.maxFiles = options.maxFiles ?? 80;
  }

  private readonly maxTasks: number;
  private readonly maxFiles: number;

  async load(): Promise<WorkspaceMemorySnapshot> {
    try {
      return normalizeSnapshot(JSON.parse(await readFile(this.path, "utf8")) as unknown);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return emptyWorkspaceMemorySnapshot();
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Unable to read workspace memory at ${this.path}: ${message}`);
    }
  }

  async upsertTask(task: WorkspaceTaskRecord): Promise<void> {
    this.pendingWrite = this.pendingWrite.then(async () => {
      const current = await this.load();
      const tasks = [task, ...current.tasks.filter((existing) => existing.id !== task.id)].slice(0, this.maxTasks);
      const modified = task.modifiedFiles.map((path) => ({ path, updatedAt: task.completedAt ?? new Date().toISOString() }));
      const recentlyModifiedFiles = [...modified, ...current.recentlyModifiedFiles.filter((entry) => !task.modifiedFiles.includes(entry.path))].slice(0, this.maxFiles);
      await this.write({ version: 1, updatedAt: new Date().toISOString(), tasks, recentlyModifiedFiles, repository: current.repository });
    });
    return this.pendingWrite;
  }

  async updateRepositoryState(state: WorkspaceRepositoryState): Promise<void> {
    this.pendingWrite = this.pendingWrite.then(async () => {
      const current = await this.load();
      await this.write({ ...current, updatedAt: new Date().toISOString(), repository: state });
    });
    return this.pendingWrite;
  }

  async clear(): Promise<void> {
    this.pendingWrite = this.pendingWrite.then(async () => {
      await rm(this.path, { force: true });
    });
    return this.pendingWrite;
  }

  private async write(snapshot: WorkspaceMemorySnapshot): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    await rename(temporaryPath, this.path);
  }
}
