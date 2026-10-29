import {
  boundedJsonBytes,
  byteLimit,
  defaultContextBytes,
  readBoundedText,
} from "./resource-limits.js";
import type { ChatMessage, Session } from "./contracts.js";
import type { WorkspaceMemoryStore } from "./memory.js";
import type { WorkspacePlanStore } from "./plans.js";
import { resolveWorkspacePath } from "./workspace.js";

/** Select recent complete exchanges; never retain a result without its whole call group. */
function recentExchanges(
  messages: readonly ChatMessage[],
  maxMessages: number,
  maximumBytes: number,
  prefix: readonly ChatMessage[],
): ChatMessage[] {
  const groups: ChatMessage[][] = [];
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]!;
    if (message.role === "tool") continue;
    const group = [message];
    if (message.role === "assistant" && message.toolCalls?.length) {
      const pending = new Set(message.toolCalls.map((call) => call.id));
      while (messages[index + 1]?.role === "tool") {
        const result = messages[++index]!;
        if (result.toolCallId && pending.delete(result.toolCallId))
          group.push(result);
      }
      if (pending.size) continue;
    }
    groups.push(group);
  }
  const selected: ChatMessage[] = [];
  for (const group of groups.reverse()) {
    if (selected.length + group.length > maxMessages) break;
    if (
      boundedJsonBytes([...prefix, ...group, ...selected], maximumBytes) >
      maximumBytes
    )
      break;
    selected.unshift(...group);
  }
  return selected;
}

export interface ContextManager {
  build(
    session: Session,
    systemPrompt?: string,
    requestContext?: readonly ContextBlock[],
  ): Promise<ChatMessage[]>;
}

/** Keeps a bounded recent conversation; richer repository context can implement this interface later. */
export class RecentHistoryContextManager implements ContextManager {
  constructor(
    private readonly maxMessages = 40,
    private readonly maxContextCharacters = 24_000,
    private readonly maxHistoryBytes = defaultContextBytes,
  ) {}
  async build(
    session: Session,
    systemPrompt?: string,
    requestContext: readonly ContextBlock[] = [],
  ): Promise<ChatMessage[]> {
    return buildBoundedContext(
      session,
      systemPrompt,
      requestContext,
      this.maxMessages,
      this.maxContextCharacters,
      this.maxHistoryBytes,
    );
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

export function formatContextBlocks(
  blocks: readonly ContextBlock[],
  maxCharacters: number,
  maxBytes = defaultContextBytes,
): string {
  let remainingBytes = maxBytes;
  let remaining = maxCharacters;
  const selected: string[] = [];
  const prioritized = [...blocks].sort(
    (left, right) => (right.priority ?? 0) - (left.priority ?? 0),
  );

  for (const block of prioritized) {
    if (
      block.source.length + block.content.length > remaining ||
      block.source.length + block.content.length > remainingBytes
    )
      continue;
    const source = block.source
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;");
    const formatted = `<context source="${source}">\n${block.content}\n</context>`;
    const separator = selected.length ? 2 : 0;
    const bytes = Buffer.byteLength(formatted) + separator;
    if (formatted.length + separator > remaining || bytes > remainingBytes)
      continue;

    selected.push(formatted);
    remaining -= formatted.length + separator;
    remainingBytes -= bytes;
  }

  return selected.join("\n\n");
}

export class StaticContextProvider implements ContextProvider {
  constructor(private readonly blocks: readonly ContextBlock[]) {}
  async collect(): Promise<readonly ContextBlock[]> {
    return this.blocks;
  }
}

export interface WorkspaceFileContextOptions {
  readonly maxBytes?: number;
  readonly maxFileBytes?: number;
}

export class WorkspaceFileContextProvider implements ContextProvider {
  constructor(
    private readonly workspaceRoot: string,
    private readonly paths: readonly string[],
    private readonly options: WorkspaceFileContextOptions = {},
  ) {}

  async collect(): Promise<readonly ContextBlock[]> {
    const blocks: ContextBlock[] = [];
    let remaining = byteLimit(this.options.maxBytes ?? 24_000);
    const perFile = byteLimit(this.options.maxFileBytes ?? 12_000);
    for (const path of this.paths) {
      if (remaining < 2) break;
      const fullPath = resolveWorkspacePath(this.workspaceRoot, path);
      const { text } = await readBoundedText(
        fullPath,
        Math.min(remaining, perFile),
      );
      blocks.push({ source: path, content: text, priority: 100 });
      remaining -= Buffer.byteLength(text);
    }
    return blocks;
  }
}

/** Supplies recent repository progress to new conversations without replaying full transcripts. */
export class WorkspaceMemoryContextProvider implements ContextProvider {
  constructor(
    private readonly memory: WorkspaceMemoryStore,
    private readonly maxTasks = 8,
  ) {}

  async collect(): Promise<readonly ContextBlock[]> {
    let snapshot: Awaited<ReturnType<WorkspaceMemoryStore["load"]>>;
    try {
      snapshot = await this.memory.load();
    } catch {
      return [];
    }
    if (
      !snapshot.tasks.length &&
      !snapshot.recentlyModifiedFiles.length &&
      !snapshot.repository
    )
      return [];
    const taskLines = snapshot.tasks.slice(0, this.maxTasks).map((task) => {
      const files = task.modifiedFiles.length
        ? ` Files: ${task.modifiedFiles.join(", ")}.`
        : "";
      const summary = task.assistantSummary
        ? ` Result: ${task.assistantSummary}`
        : "";
      return `- [${task.status}] ${task.objective}${files}${summary}`;
    });
    const files = snapshot.recentlyModifiedFiles
      .slice(0, 12)
      .map((file) => file.path);
    const repository = snapshot.repository
      ? [
          `Repository snapshot (${snapshot.repository.updatedAt}):`,
          snapshot.repository.branch
            ? `- Branch: ${snapshot.repository.branch}`
            : "",
          snapshot.repository.changedFiles.length
            ? `- Changed files: ${snapshot.repository.changedFiles.slice(0, 20).join(", ")}`
            : "- Changed files: none",
          snapshot.repository.summary
            ? `- Diff summary: ${snapshot.repository.summary.slice(0, 1_200)}`
            : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "";
    const content = [
      taskLines.length ? `Recent tasks:\n${taskLines.join("\n")}` : "",
      files.length
        ? `Recently modified files:\n${files.map((file) => `- ${file}`).join("\n")}`
        : "",
      repository,
    ]
      .filter(Boolean)
      .join("\n\n");
    return [{ source: "workspace-memory", content, priority: 40 }];
  }
}

/** Makes the active implementation checklist available to subsequent agent turns. */
export class WorkspacePlanContextProvider implements ContextProvider {
  constructor(private readonly plans: WorkspacePlanStore) {}

  async collect(): Promise<readonly ContextBlock[]> {
    let plan: Awaited<ReturnType<WorkspacePlanStore["load"]>>;
    try {
      plan = await this.plans.load();
    } catch {
      return [];
    }
    if (!plan || plan.status === "completed") return [];
    const steps = plan.steps
      .map(
        (step) =>
          `- [${step.status === "completed" ? "x" : " "}] (${step.id}) ${step.content}`,
      )
      .join("\n");
    return [
      {
        source: "active-plan",
        content: `Active plan: ${plan.title}\n${steps}\n\nWhen implementing, keep this plan accurate with update_plan.`,
        priority: 60,
      },
    ];
  }
}

export class CompositeContextManager implements ContextManager {
  constructor(
    private readonly providers: readonly ContextProvider[] = [],
    private readonly options: {
      maxMessages?: number;
      maxContextCharacters?: number;
      maxHistoryBytes?: number;
    } = {},
  ) {}

  async build(
    session: Session,
    systemPrompt?: string,
    requestContext: readonly ContextBlock[] = [],
  ): Promise<ChatMessage[]> {
    const maxMessages = this.options.maxMessages ?? 40;
    const blocks = [
      ...requestContext,
      ...(
        await Promise.all(
          this.providers.map((provider) => provider.collect(session)),
        )
      ).flat(),
    ];
    return buildBoundedContext(
      session,
      systemPrompt,
      blocks,
      maxMessages,
      this.options.maxContextCharacters ?? 24_000,
      this.options.maxHistoryBytes ?? defaultContextBytes,
    );
  }
}

function buildBoundedContext(
  session: Session,
  systemPrompt: string | undefined,
  blocks: readonly ContextBlock[],
  maxMessages: number,
  maxCharacters: number,
  maxBytes: number,
): ChatMessage[] {
  byteLimit(maxBytes);
  const system: ChatMessage[] = systemPrompt
    ? [{ role: "system", content: systemPrompt }]
    : [];
  const systemBytes = boundedJsonBytes(system, maxBytes);
  if (systemBytes > maxBytes)
    throw new Error("System instructions exceed the context byte budget.");
  // JSON escaping can expand source text by up to six bytes per UTF-16 unit.
  const context = formatContextBlocks(
    blocks,
    maxCharacters,
    maxBytes - systemBytes,
  );
  const prompt = [
    systemPrompt,
    context ? `Workspace context:\n${context}` : undefined,
  ]
    .filter(Boolean)
    .join("\n\n");
  const prefix: ChatMessage[] = prompt
    ? [{ role: "system", content: prompt }]
    : [];
  // If escaped workspace blocks overflow, retain the intact system instructions.
  const selectedPrefix =
    boundedJsonBytes(prefix, maxBytes) <= maxBytes ? prefix : system;
  return [
    ...selectedPrefix,
    ...recentExchanges(session.messages, maxMessages, maxBytes, selectedPrefix),
  ];
}
