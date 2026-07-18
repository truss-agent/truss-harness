import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { spawn } from "node:child_process";
import type { AgentTool, JsonObject, ToolExecutionContext, ToolResult } from "./contracts.js";
import type { PlanStepStatus, WorkspacePlanStore } from "./plans.js";
import { resolveWorkspacePath } from "./workspace.js";

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool>();

  register(tool: AgentTool): void {
    if (this.tools.has(tool.name)) throw new Error(`Tool already registered: ${tool.name}`);
    this.tools.set(tool.name, tool);
  }
  get(name: string): AgentTool | undefined { return this.tools.get(name); }
  definitions() { return [...this.tools.values()].map(({ name, description, inputSchema }) => ({ name, description, inputSchema })); }
}

function stringInput(input: JsonObject, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value) throw new Error(`'${key}' must be a non-empty string`);
  return value;
}

function optionalStringInput(input: JsonObject, key: string, fallback: string): string {
  const value = input[key];
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !value) throw new Error(`'${key}' must be a non-empty string`);
  return value;
}

function optionalNumberInput(input: JsonObject, key: string, fallback: number): number {
  const value = input[key];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`'${key}' must be a positive number`);
  }
  return value;
}

const pathSchema = { type: "object" as const, properties: { path: { type: "string" } }, required: ["path"] };
const ignoredDirectories = new Set([".git", "node_modules", "dist", "coverage"]);

export const readFileTool: AgentTool = {
  name: "read_file", description: "Read a UTF-8 file using a workspace-relative path such as README.md. Absolute paths are not allowed.", inputSchema: pathSchema,
  async execute(input, context) { return { content: await readFile(resolveWorkspacePath(context.workspaceRoot, stringInput(input, "path")), "utf8") }; }
};

export const writeFileTool: AgentTool = {
  name: "write_file", description: "Create or fully replace a UTF-8 file using a workspace-relative path. For a focused change to an existing file, prefer replace_in_file. Absolute paths are not allowed.",
  inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
  async execute(input, context) {
    const content = stringInput(input, "content");
    const fullPath = resolveWorkspacePath(context.workspaceRoot, stringInput(input, "path"));
    let existing: string | undefined;
    try { existing = await readFile(fullPath, "utf8"); } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
    }
    if (existing && existing.length >= 4_096 && content.length < existing.length * 0.25) {
      throw new Error("Refusing to replace a large file with substantially less content. Use replace_in_file for a focused edit.");
    }
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, "utf8");
    return { content: "File written." };
  }
};

export const replaceInFileTool: AgentTool = {
  name: "replace_in_file", description: "Safely replace one exact unique string in a UTF-8 workspace file. Prefer this for focused edits to existing files. Read the file first to obtain the exact oldText. Absolute paths are not allowed.",
  inputSchema: { type: "object", properties: { path: { type: "string" }, oldText: { type: "string" }, newText: { type: "string" } }, required: ["path", "oldText", "newText"] },
  async execute(input, context) {
    const oldText = stringInput(input, "oldText");
    const newText = typeof input.newText === "string" ? input.newText : undefined;
    if (newText === undefined) throw new Error("'newText' must be a string");
    const fullPath = resolveWorkspacePath(context.workspaceRoot, stringInput(input, "path"));
    const existing = await readFile(fullPath, "utf8");
    const occurrences = existing.split(oldText).length - 1;
    if (occurrences !== 1) throw new Error(`Expected oldText to occur exactly once, found ${occurrences}.`);
    await writeFile(fullPath, existing.replace(oldText, newText), "utf8");
    return { content: "File updated." };
  }
};

export function createUpdatePlanTool(plans: WorkspacePlanStore): AgentTool {
  return {
    name: "update_plan",
    description: "Update the status of one active plan step. Use in Agent mode before work starts, after a step is completed, and when moving to the next step.",
    inputSchema: { type: "object", properties: { stepId: { type: "string" }, status: { type: "string", description: "pending, in_progress, or completed" } }, required: ["stepId", "status"] },
    async execute(input): Promise<ToolResult> {
      const stepId = stringInput(input, "stepId");
      const status = input.status;
      if (status !== "pending" && status !== "in_progress" && status !== "completed") throw new Error("status must be pending, in_progress, or completed");
      if (!await plans.load()) return { content: "No active plan exists. Continue the requested task without updating plan progress." };
      await plans.updateStep(stepId, status as PlanStepStatus);
      return { content: `Updated ${stepId} to ${status}.` };
    }
  };
}

export const listDirectoryTool: AgentTool = {
  name: "list_directory", description: "List entries in a workspace directory. Omit path to list the workspace root.",
  inputSchema: { type: "object", properties: { path: { type: "string" } } },
  async execute(input, context) { return { content: (await readdir(resolveWorkspacePath(context.workspaceRoot, optionalStringInput(input, "path", ".")), { withFileTypes: true })).map(e => `${e.isDirectory() ? "dir" : "file"}\t${e.name}`).join("\n") }; }
};

async function walkFiles(root: string, current: string, maxFiles: number, files: string[]): Promise<void> {
  if (files.length >= maxFiles) return;

  for (const entry of await readdir(current, { withFileTypes: true })) {
    if (files.length >= maxFiles) return;
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        await walkFiles(root, join(current, entry.name), maxFiles, files);
      }
    } else if (entry.isFile()) {
      files.push(relative(root, join(current, entry.name)));
    }
  }
}

export const searchFilesTool: AgentTool = {
  name: "search_files",
  description: "Find workspace files by path substring.",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string" }, path: { type: "string" }, maxResults: { type: "number" } },
    required: ["query"]
  },
  async execute(input, context) {
    const query = stringInput(input, "query").toLowerCase();
    const basePath = resolveWorkspacePath(context.workspaceRoot, optionalStringInput(input, "path", "."));
    const maxResults = Math.floor(optionalNumberInput(input, "maxResults", 50));
    const files: string[] = [];

    if (!(await stat(basePath)).isDirectory()) {
      return { content: "Search path is not a directory.", isError: true };
    }

    await walkFiles(context.workspaceRoot, basePath, 10_000, files);
    const matches = files.filter((file) => file.toLowerCase().includes(query)).slice(0, maxResults);
    return { content: matches.join("\n") || "No matching files." };
  }
};

export const grepTool: AgentTool = {
  name: "grep",
  description: "Search UTF-8 workspace files for a text pattern.",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string" }, path: { type: "string" }, maxResults: { type: "number" } },
    required: ["query"]
  },
  async execute(input, context) {
    const query = stringInput(input, "query");
    const basePath = resolveWorkspacePath(context.workspaceRoot, optionalStringInput(input, "path", "."));
    const maxResults = Math.floor(optionalNumberInput(input, "maxResults", 100));
    const files: string[] = [];
    const matches: string[] = [];

    await walkFiles(context.workspaceRoot, basePath, 10_000, files);

    for (const file of files) {
      if (matches.length >= maxResults) break;

      const fullPath = resolveWorkspacePath(context.workspaceRoot, file);
      const fileStat = await stat(fullPath);
      if (fileStat.size > 1_000_000) continue;

      const content = await readFile(fullPath, "utf8");
      if (content.includes("\0")) continue;

      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length && matches.length < maxResults; index++) {
        const column = lines[index].indexOf(query);
        if (column !== -1) {
          matches.push(`${file}:${index + 1}:${column + 1}: ${lines[index]}`);
        }
      }
    }

    return { content: matches.join("\n") || "No matches." };
  }
};

export function createTerminalTool(timeoutMs = 30_000): AgentTool {
  return {
    name: "run_terminal", description: "Run a build, test, Git, or inspection command from the workspace root. Do not use shell redirection or content-writing commands to edit workspace files; use write_file or replace_in_file instead.",
    inputSchema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
    async execute(input, context): Promise<ToolResult> {
      const command = stringInput(input, "command");
      if (/[>]|\b(?:add-content|set-content|out-file|tee|sed\s+-i)\b/i.test(command)) {
        return { content: "Terminal file-writing commands and shell redirection are disabled for agents. Use write_file or replace_in_file to modify workspace files.", isError: true };
      }
      return new Promise((resolveResult) => {
        const child = spawn(command, { cwd: context.workspaceRoot, shell: true, signal: context.signal, windowsHide: true });
        let output = "";
        child.stdout.on("data", (data: Buffer) => { output += data; });
        child.stderr.on("data", (data: Buffer) => { output += data; });
        const timer = setTimeout(() => child.kill(), timeoutMs);
        child.on("close", (code) => { clearTimeout(timer); resolveResult({ content: output || `Process exited with code ${code ?? "unknown"}.`, isError: code !== 0 }); });
        child.on("error", (error) => { clearTimeout(timer); resolveResult({ content: error.message, isError: true }); });
      });
    }
  };
}

export function registerFilesystemTools(registry: ToolRegistry): void {
  registry.register(readFileTool);
  registry.register(writeFileTool);
  registry.register(replaceInFileTool);
  registry.register(listDirectoryTool);
  registry.register(searchFilesTool);
  registry.register(grepTool);
}

export function registerTerminalTools(registry: ToolRegistry, options: { timeoutMs?: number } = {}): void {
  registry.register(createTerminalTool(options.timeoutMs));
}

export function registerCoreTools(registry: ToolRegistry, options: { terminalTimeoutMs?: number } = {}): void {
  registerFilesystemTools(registry);
  registerTerminalTools(registry, { timeoutMs: options.terminalTimeoutMs });
}
