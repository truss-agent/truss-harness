import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type { ChatMessage } from "@truss-harness/runtime";
import type { ApprovalRule } from "./approval-rules.js";

export interface SavedConversation {
  readonly id: string;
  readonly title: string;
  readonly workspaceRoot: string;
  readonly provider: string;
  readonly model: string;
  readonly mode: string;
  /** Tool permission mode, restored on resume. */
  readonly permission?: string;
  /** "Always allow" answers given in this conversation. */
  readonly approvals?: readonly ApprovalRule[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly messages: readonly ChatMessage[];
}

export type ConversationSummary = Omit<SavedConversation, "messages"> & {
  readonly messageCount: number;
};

export interface ConversationStore {
  list(): Promise<readonly ConversationSummary[]>;
  load(id: string): Promise<SavedConversation | undefined>;
  save(conversation: SavedConversation): Promise<void>;
  remove(id: string): Promise<void>;
}

const maxConversationBytes = 8 * 1024 * 1024;
const maxConversations = 200;
const idPattern = /^[a-z0-9-]{8,64}$/;

export function newConversationId(): string {
  return randomUUID();
}

/** First line of the first user message, bounded for lists. */
export function conversationTitle(messages: readonly ChatMessage[]): string {
  const first = messages.find((message) => message.role === "user");
  const line = first?.content.trim().split("\n")[0] ?? "";
  return line.length > 80 ? `${line.slice(0, 79)}…` : line || "Untitled";
}

export const unknownOutcome =
  "This tool call was interrupted before its result was recorded. Its outcome is unknown: inspect the workspace before retrying it.";

/**
 * Makes saved history safe to continue: every requested tool call gets a
 * result, so providers accept it, and unfinished calls are marked unknown
 * instead of being executed again.
 */
export function repairForResume(
  messages: readonly ChatMessage[],
): ChatMessage[] {
  const repaired: ChatMessage[] = [];
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (!message) continue;
    repaired.push(message);
    if (message.role !== "assistant" || !message.toolCalls?.length) continue;
    const answered = new Set<string>();
    while (messages[index + 1]?.role === "tool") {
      const result = messages[++index] as ChatMessage;
      repaired.push(result);
      if (result.toolCallId) answered.add(result.toolCallId);
    }
    for (const call of message.toolCalls)
      if (!answered.has(call.id))
        repaired.push({
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content: unknownOutcome,
        });
  }
  return repaired;
}

function isConversation(value: unknown): value is SavedConversation {
  const record = value as Record<string, unknown> | null;
  return Boolean(
    record &&
      typeof record.id === "string" &&
      idPattern.test(record.id) &&
      typeof record.title === "string" &&
      typeof record.workspaceRoot === "string" &&
      typeof record.updatedAt === "string" &&
      typeof record.createdAt === "string" &&
      Array.isArray(record.messages) &&
      record.messages.every(
        (message: unknown) =>
          typeof (message as ChatMessage)?.content === "string" &&
          ["system", "user", "assistant", "tool"].includes(
            (message as ChatMessage).role,
          ),
      ),
  );
}

/**
 * One JSON file per conversation under a user-owned directory, partitioned
 * by the canonical workspace path. Writes are atomic; a corrupt file only
 * hides that conversation.
 */
export class FileConversationStore implements ConversationStore {
  private directory: Promise<string> | undefined;

  constructor(
    private readonly root: string,
    private readonly workspaceRoot: string,
  ) {}

  async list(): Promise<readonly ConversationSummary[]> {
    const directory = await this.workspaceDirectory();
    const names = await readdir(directory).catch(() => [] as string[]);
    const loaded = await Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .map((name) => this.load(name.slice(0, -5))),
    );
    return loaded
      .filter((value): value is SavedConversation => Boolean(value))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(({ messages, ...summary }) => ({
        ...summary,
        messageCount: messages.length,
      }));
  }

  async load(id: string): Promise<SavedConversation | undefined> {
    if (!idPattern.test(id)) return undefined;
    try {
      const text = await readFile(
        join(await this.workspaceDirectory(), `${id}.json`),
        "utf8",
      );
      if (text.length > maxConversationBytes) return undefined;
      const value = JSON.parse(text) as unknown;
      return isConversation(value) && value.id === id ? value : undefined;
    } catch {
      return undefined;
    }
  }

  async save(conversation: SavedConversation): Promise<void> {
    if (!idPattern.test(conversation.id))
      throw new Error("Conversation IDs must be safe file names.");
    const text = JSON.stringify(conversation);
    if (text.length > maxConversationBytes)
      throw new Error("This conversation is too large to save.");
    const directory = await this.workspaceDirectory();
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const target = join(directory, `${conversation.id}.json`);
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, text, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
    await this.prune();
  }

  async remove(id: string): Promise<void> {
    if (!idPattern.test(id)) return;
    await rm(join(await this.workspaceDirectory(), `${id}.json`), {
      force: true,
    });
  }

  private async prune(): Promise<void> {
    const conversations = await this.list();
    await Promise.all(
      conversations
        .slice(maxConversations)
        .map((conversation) => this.remove(conversation.id)),
    );
  }

  private workspaceDirectory(): Promise<string> {
    this.directory ??= realpath(this.workspaceRoot)
      .catch(() => this.workspaceRoot)
      .then((canonical) =>
        join(
          this.root,
          createHash("sha256").update(canonical).digest("hex").slice(0, 32),
        ),
      );
    return this.directory;
  }
}
