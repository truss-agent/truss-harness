import type {
  AgentMode,
  ApprovalMode,
  ChatItem,
  GatewayCommandResult,
  RemoteEvent,
  ToolApproval,
  Workspace,
} from "./contracts";
import { gatewayEventUrl } from "./gateway-transport";

export interface GatewayCommandClient {
  command(
    body: Record<string, unknown>,
    version?: number,
  ): Promise<GatewayCommandResult>;
}

export interface GatewayEventSocket {
  readonly readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: ((event: { readonly code: number }) => void) | null;
  send(payload: string): void;
  close(): void;
}

export interface GatewayEventConnectionInput {
  readonly gatewayUrl: string;
  readonly token: string;
  readonly onConnectionChange: (connected: boolean) => void;
  readonly onEvent: (event: RemoteEvent) => void;
  readonly onDisconnected: (message: string) => void;
}

export type GatewaySocketFactory = (url: string) => GatewayEventSocket;

export class MobileGatewayEventController {
  private socket: GatewayEventSocket | undefined;
  private connected = false;

  constructor(
    private readonly createSocket: GatewaySocketFactory = (url) =>
      new WebSocket(url) as unknown as GatewayEventSocket,
  ) {}

  async ensureConnected(input: GatewayEventConnectionInput): Promise<void> {
    if (this.connected && this.socket?.readyState === 1) return;
    await this.connect(input);
  }

  connect(input: GatewayEventConnectionInput): Promise<void> {
    this.close();
    input.onConnectionChange(false);
    const socket = this.createSocket(gatewayEventUrl(input.gatewayUrl));
    this.socket = socket;
    let settled = false;
    let authenticated = false;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        socket.close();
        reject(
          new Error(
            "The gateway event stream did not authenticate within 8 seconds.",
          ),
        );
      }, 8_000);
      const rejectConnection = (message: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(new Error(message));
      };
      socket.onopen = () =>
        socket.send(
          JSON.stringify({
            type: "authenticate",
            token: input.token,
            protocolVersions: [3, 2, 1],
          }),
        );
      socket.onmessage = ({ data }) => {
        let event: RemoteEvent;
        try {
          event = JSON.parse(String(data)) as RemoteEvent;
        } catch {
          return;
        }
        if (event.type === "connected") {
          authenticated = true;
          this.connected = true;
          input.onConnectionChange(true);
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            resolve();
          }
          return;
        }
        input.onEvent(event);
      };
      socket.onerror = () => {
        if (!authenticated) {
          rejectConnection(
            "Unable to connect to the gateway event stream. Keep the paired host open and confirm both devices are on the same network.",
          );
        } else if (this.socket === socket) {
          input.onDisconnected("Gateway event stream disconnected.");
        }
      };
      socket.onclose = ({ code }) => {
        if (this.socket === socket) {
          this.connected = false;
          input.onConnectionChange(false);
        }
        if (!authenticated) {
          rejectConnection(
            code === 1008
              ? "The gateway rejected event-stream authentication. Pair the device again to refresh its token."
              : "The gateway event stream closed before authentication.",
          );
        } else if (this.socket === socket) {
          input.onDisconnected(
            "Gateway event stream disconnected. Truss will reconnect before the next request.",
          );
        }
      };
    });
  }

  close(): void {
    this.socket?.close();
    this.socket = undefined;
    this.connected = false;
  }
}

export function appendAssistantMessage(
  messages: readonly ChatItem[],
  text: string,
  createId: () => string,
): readonly ChatItem[] {
  const last = messages.at(-1);
  return last?.role === "assistant"
    ? [...messages.slice(0, -1), { ...last, content: last.content + text }]
    : [...messages, { id: createId(), role: "assistant", content: text }];
}

export function appendSystemMessage(
  messages: readonly ChatItem[],
  content: string,
  createId: () => string,
): readonly ChatItem[] {
  return [...messages, { id: createId(), role: "system", content }];
}

export function approvalForRemoteEvent(
  event: RemoteEvent,
  approvalMode: ApprovalMode,
  readOnlyTools: ReadonlySet<string>,
): ToolApproval | undefined {
  if (
    event.type !== "tool_call_requested" ||
    !event.callId ||
    !event.tool ||
    !event.input
  )
    return undefined;
  if (
    approvalMode === "auto-all" ||
    (approvalMode === "auto-read" && readOnlyTools.has(event.tool))
  )
    return undefined;
  return { callId: event.callId, tool: event.tool, input: event.input };
}

export async function createRemoteSession(
  client: GatewayCommandClient,
  input: {
    readonly workspace: Workspace;
    readonly mode: AgentMode;
    readonly approvalMode: ApprovalMode;
  },
): Promise<string> {
  if (!input.workspace.capabilities.modes.includes(input.mode)) {
    throw new Error(
      `${input.workspace.displayName} does not support ${input.mode} mode.`,
    );
  }
  const result = await client.command({
    type: "create_session",
    workspaceId: input.workspace.id,
    mode: input.mode,
    toolApprovalMode: input.approvalMode,
  });
  if (result.type !== "session_created" || !result.sessionId) {
    throw new Error("The gateway did not create a usable session.");
  }
  return result.sessionId;
}

export async function changeRemoteSessionMode(
  client: GatewayCommandClient,
  input: {
    readonly sessionId: string;
    readonly mode: AgentMode;
    readonly approvalMode: ApprovalMode;
  },
): Promise<string> {
  const result = await client.command({
    type: "change_session_mode",
    sessionId: input.sessionId,
    mode: input.mode,
    toolApprovalMode: input.approvalMode,
  });
  if (result.type !== "session_created" || !result.sessionId) {
    throw new Error("The gateway did not create a usable replacement session.");
  }
  return result.sessionId;
}

export function describeToolFailure(event: RemoteEvent): string | undefined {
  if (event.type !== "tool_completed" || !event.tool || !event.result?.isError)
    return undefined;
  const detail =
    event.result.content.length > 360
      ? `${event.result.content.slice(0, 357)}...`
      : event.result.content;
  return `${event.tool} failed: ${detail}`;
}
