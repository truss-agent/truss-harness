import {
  type ChatMessage,
  type ContextBlock,
  EventBus,
  type RuntimeEvent,
  type Session,
  type ToolCall,
} from "@truss-harness/runtime";
import { describe, expect, it } from "vitest";
import {
  LOCAL_SERVICE_PROTOCOL_VERSION,
  ProtocolToolApproval,
  RuntimeService,
  type RuntimeServiceHost,
  type RuntimeServiceMessage,
  type RuntimeServiceRuntime,
  type RuntimeServiceWireMessage,
} from "./protocol.js";

function session(id = "session"): Session {
  return {
    id,
    createdAt: new Date(),
    updatedAt: new Date(),
    messages: [],
  };
}

class FakeRuntime implements RuntimeServiceRuntime {
  readonly sessions = new Map<string, Session>();
  runImplementation: RuntimeServiceRuntime["run"] = async () => {};
  lastContext: readonly ContextBlock[] = [];

  async createSession(messages: readonly ChatMessage[] = []): Promise<Session> {
    const value = session(`session-${this.sessions.size + 1}`);
    value.messages.push(...messages);
    this.sessions.set(value.id, value);
    return value;
  }

  async getSession(sessionId: string): Promise<Session | undefined> {
    return this.sessions.get(sessionId);
  }

  async run(
    sessionId: string,
    prompt: string,
    signal?: AbortSignal,
    context: readonly ContextBlock[] = [],
  ): Promise<void> {
    this.lastContext = context;
    return this.runImplementation(sessionId, prompt, signal, context);
  }
}

function harness(
  options: {
    readonly runtime?: FakeRuntime;
    readonly approval?: ProtocolToolApproval;
    readonly allowLegacyRequests?: boolean;
    readonly host?: RuntimeServiceHost;
  } = {},
) {
  const messages: RuntimeServiceMessage[] = [];
  const events = new EventBus<RuntimeEvent>();
  const runtime = options.runtime ?? new FakeRuntime();
  const service = new RuntimeService({
    runtime,
    events,
    approval: options.approval,
    host: options.host,
    allowLegacyRequests: options.allowLegacyRequests,
    serverVersion: "test",
    write: (message) => messages.push(message as RuntimeServiceMessage),
  });
  return { events, messages, runtime, service };
}

async function waitFor(
  predicate: () => boolean,
  message: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(message);
}

const readCall: ToolCall = {
  id: "read",
  name: "read_file",
  input: { path: "README.md" },
};
const writeCall: ToolCall = {
  id: "write",
  name: "write_file",
  input: { path: "README.md", content: "updated" },
};

describe("ProtocolToolApproval", () => {
  it("automatically permits only read tools in auto-read mode", async () => {
    const approval = new ProtocolToolApproval("auto-read");
    await expect(approval.approve(readCall, session())).resolves.toBe(true);

    const pending = approval.approve(writeCall, session());
    expect(approval.resolve("write", false)).toBe(true);
    await expect(pending).resolves.toBe(false);
  });

  it("automatically permits every tool in auto-all mode", async () => {
    const approval = new ProtocolToolApproval("auto-all");
    await expect(approval.approve(writeCall, session())).resolves.toBe(true);
  });

  it("denies only approvals belonging to a cancelled session", async () => {
    const approval = new ProtocolToolApproval();
    const first = approval.approve(
      { ...writeCall, id: "first" },
      session("first-session"),
    );
    const second = approval.approve(
      { ...writeCall, id: "second" },
      session("second-session"),
    );

    approval.denySession("first-session");
    await expect(first).resolves.toBe(false);
    expect(approval.resolve("second", true)).toBe(true);
    await expect(second).resolves.toBe(true);
  });

  it("notifies subscribers only when a tool needs client approval", async () => {
    const approval = new ProtocolToolApproval("auto-read");
    const pending: string[] = [];
    approval.subscribe((call) => pending.push(call.id));

    await expect(approval.approve(readCall, session())).resolves.toBe(true);
    const write = approval.approve(writeCall, session());
    expect(pending).toEqual(["write"]);
    approval.resolve("write", true);
    await expect(write).resolves.toBe(true);
  });
});

describe("RuntimeService", () => {
  it("uses standards-based JSON-RPC framing for versioned clients", async () => {
    const messages: RuntimeServiceWireMessage[] = [];
    const runtime = new FakeRuntime();
    const events = new EventBus<RuntimeEvent>();
    const service = new RuntimeService({
      runtime,
      events,
      serverVersion: "test",
      write: (message) => messages.push(message),
    });

    await service.handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "init",
        method: "initialize",
        params: {
          protocolVersions: [LOCAL_SERVICE_PROTOCOL_VERSION],
          client: { name: "truss.nvim", version: "0.1.0" },
        },
      }),
    );

    expect(messages).toEqual([
      {
        jsonrpc: "2.0",
        id: "init",
        result: expect.objectContaining({
          protocolVersion: LOCAL_SERVICE_PROTOCOL_VERSION,
          server: expect.objectContaining({
            identity: {
              runtime: {
                packageName: "@truss-harness/runtime",
                version: "0.1.11",
              },
              protocolVersions: [LOCAL_SERVICE_PROTOCOL_VERSION],
            },
          }),
          capabilities: expect.objectContaining({
            streaming: true,
            cancellation: true,
          }),
        }),
      },
    ]);
    await service.close();
  });

  it("requires JSON-RPC clients to initialize before other methods", async () => {
    const messages: RuntimeServiceWireMessage[] = [];
    const service = new RuntimeService({
      runtime: new FakeRuntime(),
      events: new EventBus<RuntimeEvent>(),
      write: (message) => messages.push(message),
    });

    await service.handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "ping",
        method: "service/ping",
        params: {},
      }),
    );

    expect(messages).toEqual([
      {
        jsonrpc: "2.0",
        id: "ping",
        error: expect.objectContaining({
          code: -32600,
          data: { code: "invalid_request" },
        }),
      },
    ]);
    await service.close();
  });

  it("negotiates a version and returns explicit capabilities", async () => {
    const { messages, service } = harness({
      approval: new ProtocolToolApproval(),
      allowLegacyRequests: false,
    });

    await service.handleLine(
      JSON.stringify({
        type: "initialize",
        requestId: "init",
        protocolVersions: [99, LOCAL_SERVICE_PROTOCOL_VERSION],
        client: { name: "truss.nvim", version: "0.1.0" },
      }),
    );

    expect(messages).toEqual([
      {
        type: "response",
        requestId: "init",
        result: {
          protocolVersion: LOCAL_SERVICE_PROTOCOL_VERSION,
          server: expect.objectContaining({
            name: "truss-cli",
            version: "test",
            identity: {
              runtime: {
                packageName: "@truss-harness/runtime",
                version: "0.1.11",
              },
              protocolVersions: [LOCAL_SERVICE_PROTOCOL_VERSION],
            },
          }),
          capabilities: expect.objectContaining({
            streaming: true,
            cancellation: true,
            approvals: true,
            context: true,
          }),
        },
      },
    ]);
    await service.close();
  });

  it("returns supported versions when negotiation fails", async () => {
    const { messages, service } = harness();
    await service.handleLine(
      JSON.stringify({
        type: "initialize",
        requestId: "init",
        protocolVersions: [77],
      }),
    );

    expect(messages).toEqual([
      expect.objectContaining({
        type: "error",
        requestId: "init",
        code: "unsupported_protocol",
        supportedProtocolVersions: [LOCAL_SERVICE_PROTOCOL_VERSION],
      }),
    ]);
    await service.close();
  });

  it("streams runtime and lifecycle events for a run", async () => {
    const { events, messages, runtime, service } = harness();
    runtime.runImplementation = async (sessionId) => {
      await events.emit({ type: "run_started", sessionId });
      await events.emit({ type: "text_delta", sessionId, text: "hello" });
      await events.emit({
        type: "run_completed",
        sessionId,
        modifiedFiles: ["README.md"],
      });
    };

    await service.handleLine(
      JSON.stringify({
        type: "run",
        requestId: "run-1",
        prompt: "Say hello",
        context: [{ source: "current-buffer:README.md", content: "Truss" }],
      }),
    );
    await waitFor(
      () =>
        messages.some(
          (message) =>
            message.type === "response" && message.requestId === "run-1",
        ),
      "run should complete",
    );

    expect(messages).toContainEqual({
      type: "lifecycle",
      requestId: "run-1",
      state: "started",
      sessionId: "session-1",
    });
    expect(messages).toContainEqual({
      type: "event",
      requestId: "run-1",
      event: {
        type: "text_delta",
        sessionId: "session-1",
        text: "hello",
      },
    });
    expect(messages).toContainEqual({
      type: "lifecycle",
      requestId: "run-1",
      state: "completed",
      sessionId: "session-1",
    });
    expect(runtime.lastContext).toEqual([
      { source: "current-buffer:README.md", content: "Truss" },
    ]);
    await service.close();
  });

  it("routes pending approvals to JSON-RPC clients", async () => {
    const messages: RuntimeServiceWireMessage[] = [];
    const runtime = new FakeRuntime();
    const events = new EventBus<RuntimeEvent>();
    const approval = new ProtocolToolApproval();
    runtime.runImplementation = async (sessionId) => {
      await events.emit({
        type: "tool_call_requested",
        sessionId,
        callId: writeCall.id,
        tool: writeCall.name,
        input: writeCall.input,
      });
      await approval.approve(writeCall, session(sessionId));
    };
    const service = new RuntimeService({
      runtime,
      events,
      approval,
      write: (message) => messages.push(message),
    });
    await service.handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "init",
        method: "initialize",
        params: { protocolVersions: [LOCAL_SERVICE_PROTOCOL_VERSION] },
      }),
    );
    await service.handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "run-approval",
        method: "run/start",
        params: { prompt: "Edit the readme" },
      }),
    );
    await waitFor(
      () =>
        messages.some(
          (message) =>
            "method" in message && message.method === "approval/requested",
        ),
      "approval request should reach the client",
    );
    expect(messages).toContainEqual({
      jsonrpc: "2.0",
      method: "approval/requested",
      params: {
        requestId: "run-approval",
        sessionId: "session-1",
        callId: "write",
        tool: "write_file",
        input: { path: "README.md", content: "updated" },
      },
    });
    await service.handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "approve-write",
        method: "approval/resolve",
        params: { callId: "write", approved: true },
      }),
    );
    await waitFor(
      () =>
        messages.some(
          (message) =>
            "id" in message &&
            message.id === "run-approval" &&
            "result" in message,
        ),
      "approved run should complete",
    );
    await service.close();
  });

  it("exposes safe provider, profile, and MCP host status", async () => {
    const { messages, service } = harness({
      allowLegacyRequests: false,
      host: {
        async testProviderConnection() {
          return {
            status: "connected",
            providerId: "ollama",
            modelId: "qwen3:8b",
            message: "Connected successfully.",
          };
        },
        async listProfiles() {
          return [
            {
              name: "local",
              selected: true,
              provider: "ollama",
              model: "qwen3:8b",
            },
          ];
        },
        listMcpServers() {
          return [
            {
              name: "filesystem",
              state: "connected",
              toolCount: 2,
            },
          ];
        },
      },
    });
    await service.handleLine(
      JSON.stringify({
        type: "initialize",
        requestId: "init",
        protocolVersions: [LOCAL_SERVICE_PROTOCOL_VERSION],
      }),
    );
    await service.handleLine(
      JSON.stringify({ type: "test_provider", requestId: "provider" }),
    );
    await service.handleLine(
      JSON.stringify({ type: "list_profiles", requestId: "profiles" }),
    );
    await service.handleLine(
      JSON.stringify({ type: "mcp_status", requestId: "mcp" }),
    );

    expect(messages).toContainEqual({
      type: "response",
      requestId: "provider",
      result: {
        providerConnection: {
          status: "connected",
          providerId: "ollama",
          modelId: "qwen3:8b",
          message: "Connected successfully.",
        },
      },
    });
    expect(messages).toContainEqual({
      type: "response",
      requestId: "profiles",
      result: {
        profiles: [
          {
            name: "local",
            selected: true,
            provider: "ollama",
            model: "qwen3:8b",
          },
        ],
      },
    });
    expect(messages).toContainEqual({
      type: "response",
      requestId: "mcp",
      result: {
        mcpServers: [
          {
            name: "filesystem",
            state: "connected",
            toolCount: 2,
          },
        ],
      },
    });
    await service.close();
  });

  it("cancels a run independently and acknowledges both requests", async () => {
    const { messages, runtime, service } = harness();
    runtime.runImplementation = async (_sessionId, _prompt, signal) =>
      new Promise<void>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      });

    await service.handleLine(
      JSON.stringify({
        type: "run",
        requestId: "run-1",
        prompt: "Keep running",
      }),
    );
    await waitFor(
      () =>
        messages.some(
          (message) =>
            message.type === "lifecycle" && message.state === "started",
        ),
      "run should start",
    );
    await service.handleLine(
      JSON.stringify({
        type: "cancel",
        requestId: "cancel-1",
        targetRequestId: "run-1",
      }),
    );
    await waitFor(
      () =>
        messages.some(
          (message) =>
            message.type === "response" &&
            message.requestId === "run-1" &&
            message.result.aborted,
        ),
      "run should report cancellation",
    );

    expect(messages).toContainEqual({
      type: "response",
      requestId: "cancel-1",
      result: { cancelled: true, targetRequestId: "run-1" },
    });
    expect(messages).toContainEqual({
      type: "lifecycle",
      requestId: "run-1",
      state: "cancelled",
      sessionId: "session-1",
    });
    await service.close();
  });

  it("bounds client-provided context before starting a run", async () => {
    const { messages, service } = harness();
    await service.handleLine(
      JSON.stringify({
        type: "run",
        requestId: "oversized",
        prompt: "Inspect this",
        context: [
          {
            source: "current-buffer:large.txt",
            content: "x".repeat(250_001),
          },
        ],
      }),
    );

    expect(messages).toContainEqual(
      expect.objectContaining({
        type: "error",
        requestId: "oversized",
        code: "invalid_request",
      }),
    );
    await service.close();
  });

  it("rejects duplicate active request identifiers without racing", async () => {
    const { messages, runtime, service } = harness();
    runtime.runImplementation = async (_sessionId, _prompt, signal) =>
      new Promise<void>((resolve) => {
        signal?.addEventListener("abort", () => resolve(), { once: true });
      });
    const request = JSON.stringify({
      type: "run",
      requestId: "same-run",
      prompt: "Wait",
    });

    await service.handleLine(request);
    await service.handleLine(request);

    expect(messages).toContainEqual({
      type: "error",
      requestId: "same-run",
      code: "invalid_request",
      message: "That requestId already has an active run.",
    });
    await service.close();
  });

  it("aborts active runs and stops forwarding events on close", async () => {
    const { events, messages, runtime, service } = harness();
    let aborted = false;
    runtime.runImplementation = async (_sessionId, _prompt, signal) =>
      new Promise<void>((resolve) => {
        signal?.addEventListener(
          "abort",
          () => {
            aborted = true;
            resolve();
          },
          { once: true },
        );
      });
    await service.handleLine(
      JSON.stringify({
        type: "run",
        requestId: "run-1",
        prompt: "Wait",
      }),
    );
    await waitFor(
      () =>
        messages.some(
          (message) =>
            message.type === "lifecycle" && message.state === "started",
        ),
      "run should start",
    );

    await service.close();
    const count = messages.length;
    await events.emit({
      type: "text_delta",
      sessionId: "session-1",
      text: "late",
    });

    expect(aborted).toBe(true);
    expect(messages).toHaveLength(count);
  });

  it("keeps legacy uninitialized VS Code requests compatible", async () => {
    const { messages, service } = harness();
    await service.handleLine(
      JSON.stringify({
        type: "create_session",
        requestId: "vscode-1",
        messages: [{ role: "user", content: "existing conversation" }],
      }),
    );

    expect(messages).toContainEqual({
      type: "response",
      requestId: "vscode-1",
      result: { sessionId: "session-1" },
    });
    await service.close();
  });
});
