import { describe, expect, it } from "vitest";
import type { DesktopConversation, DesktopFile } from "../../shared.js";
import {
  addTokenUsage,
  attachedWorkspacePaths,
  DesktopChatController,
  estimatedConversationUsage,
  isDirectWorkspaceChangeRequest,
  rankSlashFiles,
  tokenEstimate,
} from "./chat-controller.js";

const conversation = (
  id: string,
  updatedAt = "2026-08-13T00:00:00.000Z",
): DesktopConversation => ({
  id,
  title: id,
  messages: [],
  updatedAt,
});

describe("DesktopChatController", () => {
  it("owns conversation creation, updates, selection, and removal", () => {
    const controller = new DesktopChatController();
    const existing = conversation("existing");
    const created = controller.createConversation(
      [existing],
      "new",
      "2026-08-13T01:00:00.000Z",
    );

    expect(created.conversations.map(({ id }) => id)).toEqual([
      "new",
      "existing",
    ]);
    const updated = controller.updateConversation(
      created.conversations,
      "new",
      (current) => ({ ...current, title: "Updated" }),
    );
    expect(controller.activeConversation(updated, "new")?.title).toBe(
      "Updated",
    );
    expect(controller.removeConversation(updated, "new", "new")).toEqual({
      conversations: [existing],
      activeConversationId: "existing",
    });
  });

  it("tracks run lifecycle and streaming metrics", () => {
    const controller = new DesktopChatController();
    controller.beginRun("conversation");
    controller.recordTextDelta("hello", 25);
    controller.recordTextDelta(" world", 30);

    expect(controller.busy).toBe(true);
    expect(controller.agentActivity).toBe("Writing the response");
    expect(controller.streamMetrics).toEqual({
      startedAt: 25,
      textCharacters: 11,
    });
    expect(controller.endRun("other")).toBe(false);
    expect(controller.endRun("conversation")).toBe(true);
    expect(controller.busy).toBe(false);
    expect(controller.agentActivity).toBe("Ready");
  });

  it("owns tool activity, attachments, and bounded slash selection", () => {
    const controller = new DesktopChatController();
    controller.setActivities("conversation", [
      { callId: "call", tool: "read_file", status: "running" },
    ]);
    controller.setActivityExpanded("conversation", false);
    controller.addPendingAttachments([
      {
        id: "attachment",
        kind: "file",
        name: "notes.txt",
        mediaType: "text/plain",
        text: "hello",
        size: 5,
      },
    ]);
    controller.setSlashResults([
      { path: "one.ts", type: "file" },
      { path: "two.ts", type: "file" },
    ]);
    controller.moveSlashSelection(-1);

    expect(controller.activities("conversation")).toHaveLength(1);
    expect(controller.activityExpanded("conversation")).toBe(false);
    expect(controller.pendingAttachmentBytes()).toBe(5);
    expect(controller.selectedSlashFile()?.path).toBe("two.ts");

    controller.removePendingAttachment("attachment");
    expect(controller.pendingAttachments).toEqual([]);
  });
});

describe("chat file references", () => {
  const files: readonly DesktopFile[] = [
    { path: "src/index.ts", type: "file" },
    { path: "src/chat.ts", type: "file" },
    { path: "src", type: "directory" },
  ];

  it("ranks only matching workspace files", () => {
    expect(rankSlashFiles(files, "chat").map(({ path }) => path)).toEqual([
      "src/chat.ts",
    ]);
  });

  it("extracts unique references that exist in the workspace", () => {
    expect(
      attachedWorkspacePaths(
        "Read /src/index.ts and /missing.ts then /src/index.ts",
        files,
      ),
    ).toEqual(["src/index.ts"]);
  });
});

describe("chat request and usage policy", () => {
  it("detects direct workspace edits and estimates context", () => {
    expect(isDirectWorkspaceChangeRequest("Please fix the failing test")).toBe(
      true,
    );
    expect(isDirectWorkspaceChangeRequest("What does this file do?")).toBe(
      false,
    );
    expect(tokenEstimate([{ role: "user", content: "12345678" }])).toBe(402);
  });

  it("accumulates provider usage and estimates missing usage", () => {
    const model = {
      id: "test-model",
      inputCostPerMillion: 2,
      outputCostPerMillion: 4,
    };
    expect(
      addTokenUsage(
        { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
        model,
      ),
    ).toEqual({
      inputTokens: 30,
      outputTokens: 15,
      totalTokens: 45,
      estimatedCostUsd: 0.00012,
    });
    expect(
      estimatedConversationUsage(
        {
          ...conversation("usage"),
          messages: [
            { role: "user", content: "12345678" },
            { role: "assistant", content: "1234" },
          ],
        },
        undefined,
      ),
    ).toMatchObject({
      inputTokens: 2,
      outputTokens: 1,
      totalTokens: 3,
      estimated: true,
    });
  });
});
