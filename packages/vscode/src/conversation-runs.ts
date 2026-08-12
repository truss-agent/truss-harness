/**
 * Tracks the extension-owned request for each live conversation. The local
 * runtime service can process independent sessions concurrently; this keeps
 * UI events and cancellation scoped to the conversation that started them.
 */
export interface ConversationRun {
  readonly conversationId: string;
  readonly requestId: string;
}

export class ConversationRunRegistry {
  private readonly byConversation = new Map<string, ConversationRun>();
  private readonly byRequest = new Map<string, ConversationRun>();

  start(conversationId: string, requestId: string): ConversationRun {
    if (this.byConversation.has(conversationId)) {
      throw new Error("That conversation already has an active run.");
    }
    const run = { conversationId, requestId };
    this.byConversation.set(conversationId, run);
    this.byRequest.set(requestId, run);
    return run;
  }

  requestForConversation(conversationId: string): string | undefined {
    return this.byConversation.get(conversationId)?.requestId;
  }

  conversationForRequest(requestId: string): string | undefined {
    return this.byRequest.get(requestId)?.conversationId;
  }

  finish(requestId: string): ConversationRun | undefined {
    const run = this.byRequest.get(requestId);
    if (!run) return undefined;
    this.byRequest.delete(requestId);
    if (this.byConversation.get(run.conversationId)?.requestId === requestId) {
      this.byConversation.delete(run.conversationId);
    }
    return run;
  }

  clear(): readonly ConversationRun[] {
    const runs = [...this.byRequest.values()];
    this.byConversation.clear();
    this.byRequest.clear();
    return runs;
  }
}
