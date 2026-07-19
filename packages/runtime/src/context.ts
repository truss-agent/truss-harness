import { readFile } from "node:fs/promises";
import type { ChatMessage, Session } from "./contracts.js";
import type { WorkspaceMemoryStore } from "./memory.js";
import type { WorkspacePlanStore } from "./plans.js";
import { resolveWorkspacePath } from "./workspace.js";

export interface ContextManager {
  build(session: Session, systemPrompt?: string, requestContext?: readonly ContextBlock[]): Promise<ChatMessage[]>;
}

/** Keeps a bounded recent conversation; richer repository context can implement this interface later. */
export class RecentHistoryContextManager implements ContextManager {
  constructor(private readonly maxMessages = 40, private readonly maxContextCharacters = 24_000) {}
  async build(session: Session, systemPrompt?: string, requestContext: readonly ContextBlock[] = []): Promise<ChatMessage[]> {
    const context = formatContextBlocks(requestContext, this.maxContextCharacters);
    const prompt = [systemPrompt, context ? `Workspace context:\n${context}` : undefined].filter(Boolean).join("\n\n");
    return [ ...(prompt ? [{ role: "system" as const, content: prompt }] : []), ...session.messages.slice(-this.maxMessages) ];
  }
}

export interface ContextBlock {
  readonly source: string;
  readonly content: string;
  readonly priority?: number;
}

export interface ContextProvider {
  collect(session: Session): Promise<readonly ContextBlock[]>;
}

export function formatContextBlocks(blocks: readonly ContextBlock[], maxCharacters: number): string {
  let remaining = maxCharacters;
  const selected: string[] = [];
  const prioritized = [...blocks].sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0));

  for (const block of prioritized) {
    const source = block.source.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
    const formatted = `<context source="${source}">\n${block.content}\n</context>`;
    if (formatted.length > remaining) continue;

    selected.push(formatted);
    remaining -= formatted.length;
  }

  return selected.join("\n\n");
}

export class StaticContextProvider implements ContextProvider {
  constructor(private readonly blocks: readonly ContextBlock[]) {}
  async collect(): Promise<readonly ContextBlock[]> { return this.blocks; }
}

export class WorkspaceFileContextProvider implements ContextProvider {
  constructor(private readonly workspaceRoot: string, private readonly paths: readonly string[]) {}

  async collect(): Promise<readonly ContextBlock[]> {
    const blocks: ContextBlock[] = [];

    for (const path of this.paths) {
      const fullPath = resolveWorkspacePath(this.workspaceRoot, path);
      blocks.push({ source: path, content: await readFile(fullPath, "utf8"), priority: 100 });
    }

    return blocks;
  }
}

/** Supplies recent repository progress to new conversations without replaying full transcripts. */
export class WorkspaceMemoryContextProvider implements ContextProvider {
  constructor(private readonly memory: WorkspaceMemoryStore, private readonly maxTasks = 8) {}

  async collect(): Promise<readonly ContextBlock[]> {
    let snapshot;
    try { snapshot = await this.memory.load(); } catch { return []; }
    if (!snapshot.tasks.length && !snapshot.recentlyModifiedFiles.length && !snapshot.repository) return [];
    const taskLines = snapshot.tasks.slice(0, this.maxTasks).map((task) => {
      const files = task.modifiedFiles.length ? ` Files: ${task.modifiedFiles.join(", ")}.` : "";
      const summary = task.assistantSummary ? ` Result: ${task.assistantSummary}` : "";
      return `- [${task.status}] ${task.objective}${files}${summary}`;
    });
    const files = snapshot.recentlyModifiedFiles.slice(0, 12).map((file) => file.path);
    const repository = snapshot.repository
      ? [
        `Repository snapshot (${snapshot.repository.updatedAt}):`,
        snapshot.repository.branch ? `- Branch: ${snapshot.repository.branch}` : "",
        snapshot.repository.changedFiles.length ? `- Changed files: ${snapshot.repository.changedFiles.slice(0, 20).join(", ")}` : "- Changed files: none",
        snapshot.repository.summary ? `- Diff summary: ${snapshot.repository.summary.slice(0, 1_200)}` : ""
      ].filter(Boolean).join("\n")
      : "";
    const content = [
      taskLines.length ? `Recent tasks:\n${taskLines.join("\n")}` : "",
      files.length ? `Recently modified files:\n${files.map((file) => `- ${file}`).join("\n")}` : "",
      repository
    ].filter(Boolean).join("\n\n");
    return [{ source: "workspace-memory", content, priority: 40 }];
  }
}

/** Makes the active implementation checklist available to subsequent agent turns. */
export class WorkspacePlanContextProvider implements ContextProvider {
  constructor(private readonly plans: WorkspacePlanStore) {}

  async collect(): Promise<readonly ContextBlock[]> {
    let plan;
    try { plan = await this.plans.load(); } catch { return []; }
    if (!plan || plan.status === "completed") return [];
    const steps = plan.steps.map((step) => `- [${step.status === "completed" ? "x" : " "}] (${step.id}) ${step.content}`).join("\n");
    return [{ source: "active-plan", content: `Active plan: ${plan.title}\n${steps}\n\nWhen implementing, keep this plan accurate with update_plan.`, priority: 60 }];
  }
}

export class CompositeContextManager implements ContextManager {
  constructor(
    private readonly providers: readonly ContextProvider[] = [],
    private readonly options: { maxMessages?: number; maxContextCharacters?: number } = {}
  ) {}

  async build(session: Session, systemPrompt?: string, requestContext: readonly ContextBlock[] = []): Promise<ChatMessage[]> {
    const maxMessages = this.options.maxMessages ?? 40;
    const blocks = [
      ...requestContext,
      ...(await Promise.all(this.providers.map((provider) => provider.collect(session)))).flat()
    ];
    const context = formatContextBlocks(blocks, this.options.maxContextCharacters ?? 24_000);
    const prompt = [systemPrompt, context ? `Workspace context:\n${context}` : undefined].filter(Boolean).join("\n\n");

    return [...(prompt ? [{ role: "system" as const, content: prompt }] : []), ...session.messages.slice(-maxMessages)];
  }
}
