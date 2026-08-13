import { describe, expect, it } from "vitest";
import {
  normalizeConversationState,
  normalizeHistory,
} from "./conversation-state.js";

describe("VS Code conversation persistence", () => {
  it("rejects malformed records and selects a valid active conversation", () => {
    const state = normalizeConversationState({
      activeId: "missing",
      conversations: [
        { id: "bad" },
        {
          id: "conversation-1",
          title: "Conversation",
          updatedAt: "2026-08-12T00:00:00.000Z",
          messages: [
            { role: "user", content: "hello" },
            { role: "system", content: "discard me" },
          ],
        },
      ],
    });
    expect(state.activeId).toBe("conversation-1");
    expect(state.conversations).toHaveLength(1);
    expect(state.conversations[0]?.messages).toEqual([
      { role: "user", content: "hello" },
    ]);
  });

  it("bounds restored history and message content", () => {
    const messages = Array.from({ length: 70 }, (_, index) => ({
      role: index % 2 ? ("assistant" as const) : ("user" as const),
      content: `${index}:${"x".repeat(5_000)}`,
    }));
    const normalized = normalizeHistory(messages);
    expect(normalized).toHaveLength(60);
    expect(normalized[0]?.content.startsWith("10:")).toBe(false);
    expect(normalized[0]?.content).toHaveLength(4_000);
  });

  it("keeps only valid attachment metadata", () => {
    const state = normalizeConversationState({
      conversations: [
        {
          id: "conversation-1",
          title: "Attachments",
          updatedAt: "2026-08-12T00:00:00.000Z",
          messages: [
            {
              role: "user",
              content: "review",
              attachments: [
                {
                  id: "file-1",
                  kind: "file",
                  name: "readme.md",
                  mediaType: "text/markdown",
                  size: 12,
                  text: "hello",
                },
                { id: "invalid", kind: "binary" },
              ],
            },
          ],
        },
      ],
    });
    expect(state.conversations[0]?.messages[0]?.attachments).toHaveLength(1);
  });
});
