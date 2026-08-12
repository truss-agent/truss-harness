import { describe, expect, it } from "vitest";
import { ConversationRunRegistry } from "./conversation-runs.js";

describe("ConversationRunRegistry", () => {
  it("routes simultaneous conversation runs independently", () => {
    const runs = new ConversationRunRegistry();
    runs.start("conversation-a", "request-a");
    runs.start("conversation-b", "request-b");

    expect(runs.requestForConversation("conversation-a")).toBe("request-a");
    expect(runs.requestForConversation("conversation-b")).toBe("request-b");
    expect(runs.conversationForRequest("request-a")).toBe("conversation-a");
    expect(runs.conversationForRequest("request-b")).toBe("conversation-b");
  });

  it("removes only the completed run and rejects a second run for one conversation", () => {
    const runs = new ConversationRunRegistry();
    runs.start("conversation-a", "request-a");
    runs.start("conversation-b", "request-b");

    expect(() => runs.start("conversation-a", "request-a2")).toThrow(
      "already has an active run",
    );
    expect(runs.finish("request-a")).toEqual({
      conversationId: "conversation-a",
      requestId: "request-a",
    });
    expect(runs.requestForConversation("conversation-a")).toBeUndefined();
    expect(runs.requestForConversation("conversation-b")).toBe("request-b");
  });
});
