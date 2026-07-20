import { describe, expect, it } from "vitest";
import { REMOTE_SESSION_PROTOCOL_VERSION, toRemoteSessionEvent } from "./remote.js";

describe("remote session contract", () => {
  it("converts runtime failures to JSON-safe, sequenced events", () => {
    expect(toRemoteSessionEvent({ type: "run_failed", sessionId: "session-1", error: new Error("host unavailable") }, 4)).toEqual({
      version: REMOTE_SESSION_PROTOCOL_VERSION,
      sequence: 4,
      type: "run_failed",
      sessionId: "session-1",
      message: "host unavailable"
    });
  });

  it("preserves tool input for host-mediated approval", () => {
    expect(toRemoteSessionEvent({ type: "tool_call_requested", sessionId: "session-1", callId: "call-1", tool: "read_file", input: { path: "README.md" } }, 5)).toMatchObject({
      version: REMOTE_SESSION_PROTOCOL_VERSION,
      sequence: 5,
      type: "tool_call_requested",
      input: { path: "README.md" }
    });
  });
});
