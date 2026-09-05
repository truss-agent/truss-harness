import type { ChatAttachment } from "@truss-harness/runtime";
import type {
  DesktopConversation,
  DesktopFile,
  DesktopMessage,
  DesktopModelInfo,
  DesktopTokenUsage,
  DesktopToolActivity,
} from "../../shared.js";
import { fuzzyPathScore } from "../files/workspace-files-controller.js";

const initialAgentActivity = "Ready";
const initialRunActivity = "Thinking about the next step";

export interface ChatStreamMetrics {
  readonly startedAt: number;
  readonly textCharacters: number;
}

export interface ConversationRemoval {
  readonly conversations: readonly DesktopConversation[];
  readonly activeConversationId?: string;
}

export class DesktopChatController {
  private readonly activityByConversation = new Map<
    string,
    DesktopToolActivity[]
  >();
  private readonly activityExpandedByConversation = new Map<string, boolean>();

  busy = false;
  runningConversationId: string | undefined;
  agentActivity = initialAgentActivity;
  streamMetrics: ChatStreamMetrics = { startedAt: 0, textCharacters: 0 };
  pendingAttachments: readonly ChatAttachment[] = [];
  slashResults: readonly DesktopFile[] = [];
  slashIndex = 0;

  activeConversation(
    conversations: readonly DesktopConversation[],
    activeConversationId: string | undefined,
  ): DesktopConversation | undefined {
    return this.conversation(conversations, activeConversationId);
  }

  conversation(
    conversations: readonly DesktopConversation[],
    id: string | undefined,
  ): DesktopConversation | undefined {
    return id
      ? conversations.find((conversation) => conversation.id === id)
      : undefined;
  }

  createConversation(
    conversations: readonly DesktopConversation[],
    id: string,
    updatedAt: string,
  ): {
    readonly conversation: DesktopConversation;
    readonly conversations: readonly DesktopConversation[];
  } {
    const conversation: DesktopConversation = {
      id,
      title: "New conversation",
      messages: [],
      updatedAt,
    };
    return { conversation, conversations: [conversation, ...conversations] };
  }

  updateConversation(
    conversations: readonly DesktopConversation[],
    conversationId: string,
    update: (conversation: DesktopConversation) => DesktopConversation,
  ): readonly DesktopConversation[] {
    return conversations.map((conversation) =>
      conversation.id === conversationId ? update(conversation) : conversation,
    );
  }

  removeConversation(
    conversations: readonly DesktopConversation[],
    activeConversationId: string | undefined,
    conversationId: string,
  ): ConversationRemoval {
    const remaining = conversations.filter(
      (conversation) => conversation.id !== conversationId,
    );
    this.activityByConversation.delete(conversationId);
    this.activityExpandedByConversation.delete(conversationId);
    return {
      conversations: remaining,
      activeConversationId:
        activeConversationId === conversationId
          ? remaining[0]?.id
          : activeConversationId,
    };
  }

  beginRun(conversationId: string): void {
    this.runningConversationId = conversationId;
    this.setBusy(true);
  }

  setBusy(next: boolean): void {
    if (next && !this.busy) {
      this.streamMetrics = { startedAt: 0, textCharacters: 0 };
      this.agentActivity = initialRunActivity;
    }
    if (!next) this.agentActivity = initialAgentActivity;
    this.busy = next;
  }

  endRun(conversationId: string): boolean {
    if (this.runningConversationId !== conversationId) return false;
    this.runningConversationId = undefined;
    this.setBusy(false);
    return true;
  }

  cancelRun(): string | undefined {
    const conversationId = this.runningConversationId;
    this.runningConversationId = undefined;
    this.setBusy(false);
    return conversationId;
  }

  setAgentActivity(activity: string): void {
    this.agentActivity = activity;
  }

  recordTextDelta(text: string, now: number): void {
    this.streamMetrics = {
      startedAt: this.streamMetrics.startedAt || now,
      textCharacters: this.streamMetrics.textCharacters + text.length,
    };
    this.agentActivity = "Writing the response";
  }

  activities(conversationId: string): readonly DesktopToolActivity[] {
    return this.activityByConversation.get(conversationId) ?? [];
  }

  setActivities(
    conversationId: string,
    activities: readonly DesktopToolActivity[],
  ): void {
    this.activityByConversation.set(conversationId, [...activities]);
  }

  restoreActivities(conversations: readonly DesktopConversation[]): void {
    this.activityByConversation.clear();
    for (const conversation of conversations) {
      if (conversation.toolActivity?.length)
        this.setActivities(conversation.id, conversation.toolActivity);
    }
  }

  activityExpanded(conversationId: string): boolean {
    return this.activityExpandedByConversation.get(conversationId) ?? true;
  }

  setActivityExpanded(conversationId: string, expanded: boolean): void {
    this.activityExpandedByConversation.set(conversationId, expanded);
  }

  setPendingAttachments(attachments: readonly ChatAttachment[]): void {
    this.pendingAttachments = [...attachments];
  }

  addPendingAttachments(attachments: readonly ChatAttachment[]): void {
    this.pendingAttachments = [...this.pendingAttachments, ...attachments];
  }

  removePendingAttachment(id: string): void {
    this.pendingAttachments = this.pendingAttachments.filter(
      (attachment) => attachment.id !== id,
    );
  }

  clearPendingAttachments(): void {
    this.pendingAttachments = [];
  }

  pendingAttachmentBytes(): number {
    return this.pendingAttachments.reduce(
      (total, attachment) => total + attachment.size,
      0,
    );
  }

  setSlashResults(results: readonly DesktopFile[]): void {
    this.slashResults = [...results];
    this.slashIndex = Math.min(
      this.slashIndex,
      Math.max(0, this.slashResults.length - 1),
    );
  }

  resetSlashSelection(): void {
    this.slashIndex = 0;
  }

  moveSlashSelection(direction: 1 | -1): void {
    if (!this.slashResults.length) return;
    this.slashIndex =
      (this.slashIndex + direction + this.slashResults.length) %
      this.slashResults.length;
  }

  selectedSlashFile(): DesktopFile | undefined {
    return this.slashResults[this.slashIndex];
  }
}

export function rankSlashFiles(
  files: readonly DesktopFile[],
  query: string,
  limit = 8,
): readonly DesktopFile[] {
  return files
    .filter((file) => file.type === "file")
    .flatMap((file) => {
      const score = fuzzyPathScore(file.path, query);
      return score === undefined ? [] : [{ file, score }];
    })
    .sort(
      (left, right) =>
        left.score - right.score ||
        left.file.path.localeCompare(right.file.path),
    )
    .slice(0, limit)
    .map(({ file }) => file);
}

export function attachedWorkspacePaths(
  prompt: string,
  files: readonly DesktopFile[],
): readonly string[] {
  const available = new Set(
    files.filter((file) => file.type === "file").map((file) => file.path),
  );
  return [
    ...new Set(
      [...prompt.matchAll(/(?:^|\s)\/([^\s]+)/g)]
        .map((match) => match[1].replaceAll("\\", "/"))
        .filter((path) => available.has(path)),
    ),
  ];
}

export function tokenEstimate(messages: readonly DesktopMessage[]): number {
  return messages.reduce(
    (total, message) => total + Math.ceil(message.content.trim().length / 4),
    400,
  );
}

export function isDirectWorkspaceChangeRequest(prompt: string): boolean {
  const action =
    "(?:add|build|change|create|delete|edit|fix|implement|make|modify|overhaul|refactor|remove|rename|replace|rewrite|rework|update|write)";
  const directRequest = new RegExp(
    `^\\s*(?:(?:please|can you|could you|would you)\\s+)?${action}\\b|^\\s*(?:i am going to|i'm going to|we need to|let's)\\s+${action}\\b`,
    "i",
  );
  const errorReport =
    /\b(?:error|exception|stack trace|uncaught|referenceerror|typeerror|syntaxerror|not working|doesn['’]t work|broken|failed)\b/i;
  return directRequest.test(prompt) || errorReport.test(prompt);
}

/** Treat a short confirmation as an edit request when it follows one. */
export function isWorkspaceChangeContinuation(
  prompt: string,
  messages: readonly DesktopMessage[],
): boolean {
  const confirmation =
    /^(?:yes(?:[,. ]+(?:do it|please|go ahead))?|yeah|yep|do it|go ahead|continue|please do|make it|build it|start|hurry up|now)[!. ]*$/i;
  return (
    confirmation.test(prompt.trim()) &&
    messages.some(
      (message) =>
        message.role === "user" && isDirectWorkspaceChangeRequest(message.content),
    )
  );
}

export function addTokenUsage(
  previous: DesktopTokenUsage | undefined,
  next: Pick<DesktopTokenUsage, "inputTokens" | "outputTokens" | "totalTokens">,
  model: DesktopModelInfo | undefined,
): DesktopTokenUsage {
  const usage = {
    inputTokens: (previous?.inputTokens ?? 0) + next.inputTokens,
    outputTokens: (previous?.outputTokens ?? 0) + next.outputTokens,
    totalTokens: (previous?.totalTokens ?? 0) + next.totalTokens,
  };
  return { ...usage, estimatedCostUsd: usageCost(usage, model) };
}

export function estimatedConversationUsage(
  conversation: DesktopConversation,
  model: DesktopModelInfo | undefined,
): DesktopTokenUsage {
  const inputTokens = conversation.messages
    .slice(0, -1)
    .reduce(
      (total, message) => total + Math.ceil(message.content.length / 4),
      0,
    );
  const outputTokens =
    conversation.messages.at(-1)?.role === "assistant"
      ? Math.ceil((conversation.messages.at(-1)?.content.length ?? 0) / 4)
      : 0;
  const usage = {
    inputTokens: Math.max(1, inputTokens),
    outputTokens,
    totalTokens: Math.max(1, inputTokens) + outputTokens,
  };
  return {
    ...usage,
    estimated: true,
    estimatedCostUsd: usageCost(usage, model),
  };
}

function usageCost(
  usage: Pick<DesktopTokenUsage, "inputTokens" | "outputTokens">,
  model: DesktopModelInfo | undefined,
): number | undefined {
  if (!model) return undefined;
  const inputCost = model.inputCostPerMillion;
  const outputCost = model.outputCostPerMillion;
  if (inputCost === undefined && outputCost === undefined) return undefined;
  return (
    (usage.inputTokens / 1_000_000) * (inputCost ?? 0) +
    (usage.outputTokens / 1_000_000) * (outputCost ?? 0)
  );
}
