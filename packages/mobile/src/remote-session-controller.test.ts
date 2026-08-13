import { describe, expect, it, vi } from "vitest";
import type { GatewayEventSocket } from "./remote-session-controller.js";
import {
  appendAssistantMessage,
  approvalForRemoteEvent,
  changeRemoteSessionMode,
  createRemoteSession,
  MobileGatewayEventController,
} from "./remote-session-controller.js";

class FakeSocket implements GatewayEventSocket {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { readonly code: number }) => void) | null = null;
  readonly sent: string[] = [];

  send(payload: string): void {
    this.sent.push(payload);
  }

  close(): void {
    this.readyState = 3;
  }
}

describe("mobile remote session controller", () => {
  it("opens authenticated events and forwards runtime events", async () => {
    const socket = new FakeSocket();
    const createSocket = vi.fn(() => socket);
    const controller = new MobileGatewayEventController(createSocket);
    const events: string[] = [];
    const connectionChanges: boolean[] = [];
    const connecting = controller.connect({
      gatewayUrl: "http://127.0.0.1:4787",
      token: "trusted-token",
      onConnectionChange: (connected) => connectionChanges.push(connected),
      onEvent: (event) => events.push(event.type),
      onDisconnected: vi.fn(),
    });

    socket.onopen?.();
    expect(JSON.parse(socket.sent[0]!)).toEqual({
      type: "authenticate",
      token: "trusted-token",
      protocolVersions: [3, 2, 1],
    });
    socket.readyState = 1;
    socket.onmessage?.({ data: JSON.stringify({ type: "connected" }) });
    await connecting;
    socket.onmessage?.({
      data: JSON.stringify({ type: "text_delta", text: "Hello" }),
    });

    expect(createSocket).toHaveBeenCalledWith("ws://127.0.0.1:4787/v1/events");
    expect(connectionChanges).toEqual([false, true]);
    expect(events).toEqual(["text_delta"]);
  });

  it("coalesces assistant text and only requests approval when required", () => {
    const messages = appendAssistantMessage([], "Hello", () => "one");
    expect(appendAssistantMessage(messages, " world", () => "two")).toEqual([
      { id: "one", role: "assistant", content: "Hello world" },
    ]);
    const event = {
      type: "tool_call_requested",
      callId: "call-1",
      tool: "read_file",
      input: { path: "README.md" },
    };
    expect(
      approvalForRemoteEvent(event, "auto-read", new Set(["read_file"])),
    ).toBeUndefined();
    expect(
      approvalForRemoteEvent(event, "ask", new Set(["read_file"])),
    ).toMatchObject({ callId: "call-1" });
  });

  it("creates and replaces sessions through the versioned command client", async () => {
    const command = vi
      .fn()
      .mockResolvedValueOnce({
        type: "session_created",
        sessionId: "session-1",
      })
      .mockResolvedValueOnce({
        type: "session_created",
        sessionId: "session-2",
      });
    const client = { command };
    const workspace = {
      id: "workspace-1",
      displayName: "Workspace",
      capabilities: { modes: ["chat", "plan", "edit"] as const },
    };

    await expect(
      createRemoteSession(client, {
        workspace,
        mode: "chat",
        approvalMode: "ask",
      }),
    ).resolves.toBe("session-1");
    await expect(
      changeRemoteSessionMode(client, {
        sessionId: "session-1",
        mode: "plan",
        approvalMode: "auto-read",
      }),
    ).resolves.toBe("session-2");
    expect(command).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: "create_session",
        workspaceId: "workspace-1",
      }),
    );
    expect(command).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: "change_session_mode",
        sessionId: "session-1",
        mode: "plan",
      }),
    );
  });
});
