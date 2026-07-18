import { randomUUID } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import { brand } from "@truss-harness/branding";
import { FileWorkspaceMemoryStore, type WorkspaceMemoryStore, type WorkspaceRepositoryState } from "./memory.js";

const execFile = promisify(execFileCallback);
const ignoredDirectories = new Set([".git", ".truss-harness", "node_modules", "dist", "coverage", ".next", ".turbo"]);
const managedStart = `<!-- ${brand.productSlug}:workspace-context:start -->`;
const managedEnd = `<!-- ${brand.productSlug}:workspace-context:end -->`;

export interface WorkspaceCommandDefinition {
  readonly name: string;
  readonly usage: string;
  readonly description: string;
}

export const workspaceCommands: readonly WorkspaceCommandDefinition[] = [
  { name: "/init", usage: "/init", description: "Scan the repository and create or refresh the generated workspace block in AGENTS.md." },
  { name: "/update", usage: "/update [note]", description: "Record current Git state and an optional progress note in durable workspace memory." },
  { name: "/status", usage: "/status", description: "Show the current repository state and recent durable task records." },
  { name: "/clear-memory", usage: "/clear-memory", description: "Delete this workspace's durable agent memory file." },
  { name: "/help", usage: "/help", description: "Show the available local workspace commands." }
];

export interface WorkspaceCommandResult {
  readonly handled: boolean;
  readonly ok: boolean;
  readonly command?: string;
  readonly message: string;
}

export interface ExecuteWorkspaceCommandOptions {
  readonly workspaceRoot: string;
  readonly input: string;
  readonly memory?: WorkspaceMemoryStore;
}

interface WorkspaceScan {
  readonly directories: readonly string[];
  readonly files: readonly string[];
  readonly packageNames: readonly string[];
  readonly scripts: readonly string[];
  readonly languages: readonly string[];
}

export function workspaceCommandHelp(): string {
  return ["Workspace commands (run locally; no model call):", ...workspaceCommands.map((command) => `  ${command.usage.padEnd(20)} ${command.description}`)].join("\n");
}

export async function executeWorkspaceCommand(options: ExecuteWorkspaceCommandOptions): Promise<WorkspaceCommandResult> {
  const input = options.input.trim();
  if (!input.startsWith("/")) return { handled: false, ok: true, message: "" };
  const [command, ...arguments_] = input.split(/\s+/);
  const memory = options.memory ?? new FileWorkspaceMemoryStore(options.workspaceRoot);

  if (command === "/help") return { handled: true, ok: true, command, message: workspaceCommandHelp() };
  if (command === "/init") return initializeWorkspace(options.workspaceRoot);
  if (command === "/update") return updateWorkspace(memory, options.workspaceRoot, arguments_.join(" "));
  if (command === "/status") return workspaceStatus(memory, options.workspaceRoot);
  if (command === "/clear-memory") {
    await memory.clear();
    return { handled: true, ok: true, command, message: "Cleared durable workspace memory." };
  }
  return { handled: true, ok: false, command, message: `Unknown workspace command: ${command}\n\n${workspaceCommandHelp()}` };
}

async function initializeWorkspace(workspaceRoot: string): Promise<WorkspaceCommandResult> {
  const scan = await scanWorkspace(workspaceRoot);
  const path = join(workspaceRoot, brand.agentInstructionsFile);
  const block = renderAgentWorkspaceBlock(scan);
  let current = "";
  try { current = await readFile(path, "utf8"); } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const next = current ? replaceManagedBlock(current, block) : `# Agent Instructions\n\n${block}`;
  await writeFile(path, `${next.trimEnd()}\n`, "utf8");
  return {
    handled: true,
    ok: true,
    command: "/init",
    message: current ? "Refreshed the generated workspace context in AGENTS.md; existing instructions were preserved." : "Created AGENTS.md with generated workspace context."
  };
}

async function updateWorkspace(memory: WorkspaceMemoryStore, workspaceRoot: string, note: string): Promise<WorkspaceCommandResult> {
  const repository = await collectRepositoryState(workspaceRoot);
  await memory.updateRepositoryState(repository);
  await memory.upsertTask({
    id: randomUUID(),
    sessionId: "workspace-command",
    objective: note ? `Workspace update: ${note}` : "Workspace progress update",
    status: "completed",
    startedAt: repository.updatedAt,
    completedAt: repository.updatedAt,
    assistantSummary: repository.summary,
    tools: [{ name: "workspace_update", succeeded: true }],
    modifiedFiles: repository.changedFiles
  });
  return { handled: true, ok: true, command: "/update", message: formatRepositoryState(repository, note ? `Recorded note: ${note}` : "Recorded workspace progress.") };
}

async function workspaceStatus(memory: WorkspaceMemoryStore, workspaceRoot: string): Promise<WorkspaceCommandResult> {
  const [repository, snapshot] = await Promise.all([collectRepositoryState(workspaceRoot), memory.load()]);
  const tasks = snapshot.tasks.slice(0, 5).map((task) => `- [${task.status}] ${task.objective}`).join("\n");
  return {
    handled: true,
    ok: true,
    command: "/status",
    message: [formatRepositoryState(repository, "Workspace status."), tasks ? `Recent memory:\n${tasks}` : "Recent memory: no recorded tasks."].join("\n\n")
  };
}

async function scanWorkspace(workspaceRoot: string): Promise<WorkspaceScan> {
  const files: string[] = [];
  const directories: string[] = [];
  const queue = [workspaceRoot];
  while (queue.length && files.length < 300) {
    const current = queue.shift() as string;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= 300) break;
      const path = relative(workspaceRoot, join(current, entry.name)).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) {
          directories.push(path);
          if (path.split("/").length <= 4) queue.push(join(current, entry.name));
        }
      } else if (entry.isFile()) files.push(path);
    }
  }
  const manifests = files.filter((path) => path === "package.json" || path.endsWith("/package.json")).slice(0, 24);
  const packageNames: string[] = [];
  const scripts: string[] = [];
  for (const manifest of manifests) {
    try {
      const value = JSON.parse(await readFile(join(workspaceRoot, manifest), "utf8")) as { name?: unknown; scripts?: unknown };
      if (typeof value.name === "string") packageNames.push(value.name);
      if (value.scripts && typeof value.scripts === "object") scripts.push(...Object.keys(value.scripts as Record<string, unknown>).map((name) => `${manifest}: ${name}`));
    } catch { /* A malformed package manifest should not make init unusable. */ }
  }
  const languages = [
    files.some((path) => /\.(ts|tsx)$/.test(path)) && "TypeScript",
    files.some((path) => /\.(js|jsx|mjs)$/.test(path)) && "JavaScript",
    files.some((path) => path.endsWith(".py")) && "Python",
    files.some((path) => path.endsWith(".go")) && "Go",
    files.some((path) => path.endsWith(".rs")) && "Rust"
  ].filter((value): value is string => Boolean(value));
  return { directories: directories.slice(0, 36), files: files.slice(0, 80), packageNames: [...new Set(packageNames)].slice(0, 24), scripts: [...new Set(scripts)].slice(0, 36), languages };
}

function renderAgentWorkspaceBlock(scan: WorkspaceScan): string {
  const directories = scan.directories.length ? scan.directories.map((path) => `- \`${path}/\``).join("\n") : "- No source directories detected.";
  const packages = scan.packageNames.length ? scan.packageNames.map((name) => `- \`${name}\``).join("\n") : "- No package manifests detected.";
  const scripts = scan.scripts.length ? scan.scripts.map((script) => `- \`${script}\``).join("\n") : "- No package scripts detected.";
  return `${managedStart}
## Generated Workspace Context

This block is generated by \`/init\` from ${brand.productName}. Refresh it after structural changes; keep project-specific instructions outside these markers.

### Detected Stack

- Languages: ${scan.languages.join(", ") || "not detected"}
- Files scanned: ${scan.files.length}

### Top-Level Directories

${directories}

### Packages

${packages}

### Useful Package Scripts

${scripts}

### Working Rules

- Read the closest \`AGENTS.md\` before changing code.
- Keep edits scoped, run the relevant tests, and update durable workspace memory with \`/update\` after meaningful work.
${managedEnd}`;
}

function replaceManagedBlock(current: string, block: string): string {
  const start = current.indexOf(managedStart);
  const end = current.indexOf(managedEnd);
  if (start >= 0 && end >= start) return `${current.slice(0, start).trimEnd()}\n\n${block}\n${current.slice(end + managedEnd.length).trimStart()}`;
  return `${current.trimEnd()}\n\n${block}\n`;
}

async function collectRepositoryState(workspaceRoot: string): Promise<WorkspaceRepositoryState> {
  const updatedAt = new Date().toISOString();
  const branch = await git(workspaceRoot, ["branch", "--show-current"]);
  const status = await git(workspaceRoot, ["status", "--short"]);
  const changedFiles = status ? status.split(/\r?\n/).filter(Boolean).map((line) => line.slice(3).trim()).filter(Boolean).slice(0, 80) : [];
  const summary = await git(workspaceRoot, ["diff", "--stat", "--no-ext-diff"]);
  return { updatedAt, branch: branch || undefined, changedFiles, summary: summary || undefined };
}

async function git(workspaceRoot: string, arguments_: readonly string[]): Promise<string> {
  try { return (await execFile("git", [...arguments_], { cwd: workspaceRoot, maxBuffer: 1_000_000 })).stdout.trim(); } catch { return ""; }
}

function formatRepositoryState(state: WorkspaceRepositoryState, heading: string): string {
  const branch = state.branch ? `Branch: ${state.branch}` : "Branch: unavailable (not a Git repository or Git is unavailable)";
  const files = state.changedFiles.length ? `Changed files:\n${state.changedFiles.map((path) => `- ${path}`).join("\n")}` : "Changed files: none";
  return [heading, branch, files, state.summary ? `Diff summary:\n${state.summary}` : ""].filter(Boolean).join("\n");
}
