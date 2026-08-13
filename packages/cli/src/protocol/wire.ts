import type {
  RuntimeServiceErrorCode,
  RuntimeServiceJsonRpcMessage,
  RuntimeServiceMessage,
} from "../protocol-contracts.js";

export function jsonRpcMessage(
  message: RuntimeServiceMessage,
): RuntimeServiceJsonRpcMessage {
  if (message.type === "response")
    return { jsonrpc: "2.0", id: message.requestId, result: message.result };
  if (message.type === "error")
    return {
      jsonrpc: "2.0",
      id: message.requestId ?? null,
      error: {
        code: jsonRpcErrorCode(message.code),
        message: message.message,
        data: {
          code: message.code,
          ...(message.supportedProtocolVersions
            ? { supportedProtocolVersions: message.supportedProtocolVersions }
            : {}),
        },
      },
    };
  if (message.type === "event")
    return {
      jsonrpc: "2.0",
      method: "runtime/event",
      params: { requestId: message.requestId, event: message.event },
    };
  if (message.type === "approval_request")
    return {
      jsonrpc: "2.0",
      method: "approval/requested",
      params: {
        requestId: message.requestId,
        sessionId: message.sessionId,
        callId: message.callId,
        tool: message.tool,
        input: message.input,
      },
    };
  return {
    jsonrpc: "2.0",
    method: "run/lifecycle",
    params: {
      requestId: message.requestId,
      state: message.state,
      ...(message.sessionId ? { sessionId: message.sessionId } : {}),
    },
  };
}

function jsonRpcErrorCode(code: RuntimeServiceErrorCode): number {
  if (code === "invalid_json") return -32700;
  if (code === "invalid_request") return -32600;
  if (code === "method_not_found") return -32601;
  if (code === "internal_error") return -32603;
  if (code === "unsupported_protocol") return -32010;
  if (code === "request_conflict") return -32009;
  return -32004;
}
