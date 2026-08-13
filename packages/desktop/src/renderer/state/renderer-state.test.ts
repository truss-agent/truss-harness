import { describe, expect, it } from "vitest";
import { RendererStateStore } from "./renderer-state.js";

describe("RendererStateStore", () => {
  it("owns configuration, conversation, credential, and model selectors", () => {
    const store = new RendererStateStore({
      workspaceRoot: "/workspace",
      zoomFactor: 1,
      updates: { checkOnLaunch: true, autoDownload: false },
      theme: { name: "default" },
      conversations: [
        {
          id: "chat-1",
          title: "One",
          messages: [],
          updatedAt: "2026-08-13T00:00:00.000Z",
        },
      ],
      activeConversationId: "chat-1",
    });

    expect(store.configuration().provider).toBe("ollama");
    expect(store.activeConversation()?.id).toBe("chat-1");
    store.setCredentialStorage("session-only");
    expect(store.credentialStorage).toBe("session-only");
    store.setModels("cloud", [{ id: "provider/model", contextWindow: 4096 }]);
    expect(store.knownModel("provider/model")?.contextWindow).toBe(4096);

    store.updateDesktop((state) => ({
      ...state,
      activeConversationId: undefined,
    }));
    expect(store.activeConversation()).toBeUndefined();
  });
});
