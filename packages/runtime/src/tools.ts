import { mkdir, opendir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { NodeProcessRunner, type ProcessRunner } from "./process-runner.js";
import {
  defaultToolOutputBytes,
  readBoundedText,
  truncateUtf8,
} from "./resource-limits.js";
import type {
  AgentTool,
  JsonObject,
  ToolExecutionContext,
  ToolResult,
} from "./contracts.js";
import type { PlanStepStatus, WorkspacePlanStore } from "./plans.js";
import { resolveWorkspacePath } from "./workspace.js";

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool>();

  register(tool: AgentTool): void {
    if (this.tools.has(tool.name))
      throw new Error(`Tool already registered: ${tool.name}`);
    this.tools.set(tool.name, tool);
  }
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }
  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }
  definitions() {
    return [...this.tools.values()].map(
      ({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema,
      }),
    );
  }
}

function nonEmptyStringInput(input: JsonObject, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value)
    throw new Error(`'${key}' must be a non-empty string`);
  return value;
}

function stringInput(input: JsonObject, key: string): string {
  const value = input[key];
  if (typeof value !== "string") throw new Error(`'${key}' must be a string`);
  return value;
}

function optionalStringInput(
  input: JsonObject,
  key: string,
  fallback: string,
): string {
  const value = input[key];
  if (value === undefined) return fallback;
  return nonEmptyStringInput(input, key);
}

function optionalNumberInput(
  input: JsonObject,
  key: string,
  fallback: number,
): number {
  const value = input[key];
  if (value === undefined) return fallback;
  const normalized =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value.trim())
        ? Number(value.trim())
        : Number.NaN;
  if (!Number.isFinite(normalized) || normalized <= 0) {
    throw new Error(`'${key}' must be a positive number`);
  }
  return normalized;
}

async function readEditableFile(path: string): Promise<string> {
  const result = await readBoundedText(path, 2_000_000);
  if (result.truncated)
    throw new Error(
      "File exceeds the 2000000-byte edit limit; use a dedicated editor.",
    );
  return result.text;
}

const pathSchema = {
  type: "object" as const,
  properties: { path: { type: "string" } },
  required: ["path"],
};
const ignoredDirectories = new Set([
  ".git",
  "node_modules",
  "dist",
  "coverage",
]);

export const readFileTool: AgentTool = {
  name: "read_file",
  description:
    "Read a UTF-8 file using a workspace-relative path such as README.md. Absolute paths are not allowed.",
  inputSchema: pathSchema,
  async execute(input, context) {
    return {
      content: (
        await readBoundedText(
          resolveWorkspacePath(
            context.workspaceRoot,
            nonEmptyStringInput(input, "path"),
          ),
          defaultToolOutputBytes,
          context.signal,
        )
      ).text,
    };
  },
};

export const writeFileTool: AgentTool = {
  name: "write_file",
  description:
    "Create a new UTF-8 file or fully replace a small file using a workspace-relative path. For an existing or large file, read it first and use replace_in_file for one focused edit; do not send an entire large file in one tool call. Absolute paths are not allowed.",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string" }, content: { type: "string" } },
    required: ["path", "content"],
  },
  async execute(input, context) {
    context.signal?.throwIfAborted();
    const content = stringInput(input, "content");
    const fullPath = resolveWorkspacePath(
      context.workspaceRoot,
      nonEmptyStringInput(input, "path"),
    );
    let existing: string | undefined;
    try {
      existing = await readEditableFile(fullPath);
    } catch (error) {
      if (
        !(
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ENOENT"
        )
      )
        throw error;
    }
    if (
      existing &&
      existing.length >= 4_096 &&
      content.length < existing.length * 0.25
    ) {
      throw new Error(
        "Refusing to replace a large file with substantially less content. Use replace_in_file for a focused edit.",
      );
    }
    await mkdir(dirname(fullPath), { recursive: true });
    context.signal?.throwIfAborted();
    await writeFile(fullPath, content, {
      encoding: "utf8",
      signal: context.signal,
    });
    return { content: "File written." };
  },
};

export const replaceInFileTool: AgentTool = {
  name: "replace_in_file",
  description:
    "Safely replace one unique contiguous string in a UTF-8 workspace file. Read the file first and copy the exact oldText. If the target file is blank, newText initializes it. Line-ending differences are handled automatically. Absolute paths are not allowed.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      oldText: { type: "string" },
      newText: { type: "string" },
    },
    required: ["path", "oldText", "newText"],
  },
  async execute(input, context) {
    context.signal?.throwIfAborted();
    const oldText = stringInput(input, "oldText");
    const newText = stringInput(input, "newText");
    const fullPath = resolveWorkspacePath(
      context.workspaceRoot,
      nonEmptyStringInput(input, "path"),
    );
    const existing = await readEditableFile(fullPath);
    // A model can reasonably use a focused replacement while scaffolding a
    // file. There is no exact excerpt to match in a blank file, so initialize
    // it from newText rather than entering an unrecoverable retry loop.
    if (!existing.trim()) {
      context.signal?.throwIfAborted();
      await writeFile(fullPath, newText, {
        encoding: "utf8",
        signal: context.signal,
      });
      return { content: "File was blank; wrote replacement content." };
    }
    const countOccurrences = (source: string, search: string) =>
      source.split(search).length - 1;
    let sourceText = oldText;
    let replacementText = newText;
    let occurrences = countOccurrences(existing, sourceText);
    if (occurrences !== 1) {
      // Models often preserve the text but use LF against a CRLF workspace.
      // This fallback remains exact and still requires one unique occurrence.
      const lineEnding = existing.includes("\r\n") ? "\r\n" : "\n";
      const normalizedOldText = oldText.replace(/\r\n|\r|\n/g, lineEnding);
      const normalizedOccurrences = countOccurrences(
        existing,
        normalizedOldText,
      );
      if (normalizedOccurrences === 1) {
        sourceText = normalizedOldText;
        replacementText = newText.replace(/\r\n|\r|\n/g, lineEnding);
        occurrences = normalizedOccurrences;
      }
    }
    if (occurrences !== 1 && /\s/.test(oldText)) {
      // Keep the actual code/text exact but tolerate model drift in indentation
      // and spacing. It is still only accepted for one unique file match.
      const escapePattern = (value: string) =>
        value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const whitespaceFlexible = new RegExp(
        oldText
          .split(/(\s+)/)
          .filter(Boolean)
          .map((part) => (/\s/.test(part) ? "\\s+" : escapePattern(part)))
          .join(""),
        "g",
      );
      const matches = [...existing.matchAll(whitespaceFlexible)];
      if (matches.length === 1) {
        const lineEnding = existing.includes("\r\n") ? "\r\n" : "\n";
        context.signal?.throwIfAborted();
        await writeFile(
          fullPath,
          existing.replace(whitespaceFlexible, () =>
            newText.replace(/\r\n|\r|\n/g, lineEnding),
          ),
          { encoding: "utf8", signal: context.signal },
        );
        return {
          content: "File updated (matched with normalized whitespace).",
        };
      }
    }
    if (occurrences !== 1)
      throw new Error(
        `Expected oldText to occur exactly once, found ${occurrences}. Read the file again and retry with one exact contiguous excerpt from its current contents.`,
      );
    context.signal?.throwIfAborted();
    await writeFile(
      fullPath,
      existing.replace(sourceText, () => replacementText),
      { encoding: "utf8", signal: context.signal },
    );
    return { content: "File updated." };
  },
};

export function createUpdatePlanTool(plans: WorkspacePlanStore): AgentTool {
  return {
    name: "update_plan",
    description:
      "Update the status of one active plan step. Use in Agent mode before work starts, after a step is completed, and when moving to the next step.",
    inputSchema: {
      type: "object",
      properties: {
        stepId: { type: "string" },
        status: {
          type: "string",
          description: "pending, in_progress, or completed",
        },
      },
      required: ["stepId", "status"],
    },
    async execute(input): Promise<ToolResult> {
      const stepId = nonEmptyStringInput(input, "stepId");
      const status = input.status;
      if (
        status !== "pending" &&
        status !== "in_progress" &&
        status !== "completed"
      )
        throw new Error("status must be pending, in_progress, or completed");
      if (!(await plans.load()))
        return {
          content:
            "No active plan exists. Continue the requested task without updating plan progress.",
        };
      await plans.updateStep(stepId, status as PlanStepStatus);
      return { content: `Updated ${stepId} to ${status}.` };
    },
  };
}

export const listDirectoryTool: AgentTool = {
  name: "list_directory",
  description:
    "List entries in a workspace directory. Omit path to list the workspace root.",
  inputSchema: { type: "object", properties: { path: { type: "string" } } },
  async execute(input, context) {
    const entries: string[] = [];
    let bytes = 0;
    for await (const entry of await opendir(
      resolveWorkspacePath(
        context.workspaceRoot,
        optionalStringInput(input, "path", "."),
      ),
    )) {
      context.signal?.throwIfAborted();
      const line = `${entry.isDirectory() ? "dir" : "file"}\t${entry.name}`;
      bytes += Buffer.byteLength(line) + 1;
      if (bytes > defaultToolOutputBytes - 30) {
        entries.push("[Content truncated]");
        break;
      }
      entries.push(line);
    }
    return { content: entries.join("\n") };
  },
};

async function walkFiles(
  root: string,
  current: string,
  maxFiles: number,
  files: string[],
): Promise<void> {
  if (files.length >= maxFiles) return;

  for await (const entry of await opendir(current)) {
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
    properties: {
      query: { type: "string" },
      path: { type: "string" },
      maxResults: { type: "number" },
    },
    required: ["query"],
  },
  async execute(input, context) {
    const query = nonEmptyStringInput(input, "query").toLowerCase();
    const basePath = resolveWorkspacePath(
      context.workspaceRoot,
      optionalStringInput(input, "path", "."),
    );
    const maxResults = Math.min(
      10_000,
      Math.floor(optionalNumberInput(input, "maxResults", 50)),
    );
    const files: string[] = [];

    if (!(await stat(basePath)).isDirectory()) {
      return { content: "Search path is not a directory.", isError: true };
    }

    await walkFiles(context.workspaceRoot, basePath, 10_000, files);
    const matches = files
      .filter((file) => file.toLowerCase().includes(query))
      .slice(0, maxResults);
    return {
      content: truncateUtf8(
        matches.join("\n") || "No matching files.",
        defaultToolOutputBytes,
      ),
    };
  },
};

export const grepTool: AgentTool = {
  name: "grep",
  description: "Search UTF-8 workspace files for a text pattern.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      path: { type: "string" },
      maxResults: { type: "number" },
    },
    required: ["query"],
  },
  async execute(input, context) {
    const query = nonEmptyStringInput(input, "query");
    const basePath = resolveWorkspacePath(
      context.workspaceRoot,
      optionalStringInput(input, "path", "."),
    );
    const maxResults = Math.min(
      10_000,
      Math.floor(optionalNumberInput(input, "maxResults", 100)),
    );
    const files: string[] = [];
    const matches: string[] = [];
    let outputBytes = 0;
    let outputFull = false;

    await walkFiles(context.workspaceRoot, basePath, 10_000, files);

    for (const file of files) {
      context.signal?.throwIfAborted();
      if (matches.length >= maxResults || outputFull) break;

      const fullPath = resolveWorkspacePath(context.workspaceRoot, file);
      const fileStat = await stat(fullPath);
      if (fileStat.size > 1_000_000) continue;

      const bounded = await readBoundedText(
        fullPath,
        1_000_000,
        context.signal,
      );
      if (bounded.truncated) continue;
      const content = bounded.text;
      if (content.includes("\0")) continue;

      const lines = content.split(/\r?\n/);
      for (
        let index = 0;
        index < lines.length && matches.length < maxResults;
        index++
      ) {
        const column = lines[index].indexOf(query);
        if (column !== -1) {
          const line = `${file}:${index + 1}:${column + 1}: ${lines[index]}`;
          const remaining = defaultToolOutputBytes - outputBytes - 1;
          if (Buffer.byteLength(line) > remaining - 30) {
            if (remaining >= 30)
              matches.push(truncateUtf8(line, remaining, true));
            outputFull = true;
            break;
          }
          matches.push(line);
          outputBytes += Buffer.byteLength(line) + 1;
        }
      }
    }

    return { content: matches.join("\n") || "No matches." };
  },
};

export interface TerminalToolOptions {
  readonly runner?: ProcessRunner;
  readonly maxOutputBytes?: number;
  readonly drainTimeoutMs?: number;
}

export function createTerminalTool(
  timeoutMs = 30_000,
  options: TerminalToolOptions = {},
): AgentTool {
  const runner = options.runner ?? new NodeProcessRunner();
  return {
    name: "run_terminal",
    description:
      "Run an approved build, test, Git, or inspection command from the workspace root. Terminal commands have the user's OS capabilities; this is not a filesystem sandbox. Use write_file or replace_in_file for workspace edits.",
    inputSchema: {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
    },
    async execute(input, context): Promise<ToolResult> {
      const command = nonEmptyStringInput(input, "command");
      // A usability guard, not an access boundary: approved shell commands have OS capabilities.
      if (
        /[>]|\b(?:add-content|set-content|out-file|tee|sed\s+-i)\b/i.test(
          command,
        )
      ) {
        return {
          content:
            "Terminal file-writing commands and shell redirection are disabled for agents. Use write_file or replace_in_file to modify workspace files.",
          isError: true,
        };
      }
      const result = await runner.run({
        command,
        cwd: context.workspaceRoot,
        signal: context.signal,
        timeoutMs,
        maxOutputBytes: options.maxOutputBytes,
        drainTimeoutMs: options.drainTimeoutMs,
      });
      const status =
        result.outcome === "timeout"
          ? "Process timed out."
          : result.outcome === "aborted"
            ? "Process aborted."
            : result.outcome === "drain_timeout"
              ? "Process output drain timed out."
              : result.outcome === "error"
                ? "Process execution failed."
                : `Process exited with code ${result.exitCode ?? "unknown"}.`;
      return {
        content: truncateUtf8(
          result.outcome === "exited"
            ? result.output || status
            : `${status}\n${result.output}`,
          options.maxOutputBytes ?? defaultToolOutputBytes,
        ),
        isError: result.outcome !== "exited" || result.exitCode !== 0,
      };
    },
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

export function registerTerminalTools(
  registry: ToolRegistry,
  options: { timeoutMs?: number } = {},
): void {
  registry.register(createTerminalTool(options.timeoutMs));
}

export function registerCoreTools(
  registry: ToolRegistry,
  options: { terminalTimeoutMs?: number } = {},
): void {
  registerFilesystemTools(registry);
  registerTerminalTools(registry, { timeoutMs: options.terminalTimeoutMs });
}
