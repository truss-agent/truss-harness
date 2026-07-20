# Mobile remote workspace client

## Goal

Deliver a React Native mobile client that lets a user converse with, monitor,
interrupt, and approve a Truss agent working in a trusted workspace host. The
phone is a thin, remote client; it never runs workspace tools, stores provider
credentials, or receives unrestricted shell access.

## Architecture

```text
React Native mobile client
  |  authenticated streaming transport (WebSocket/SSE)
  v
Remote-session gateway on a trusted Truss host
  |  in-process adapter
  v
Agent runtime + workspace + tool approval policy
```

The runtime exports provider-neutral remote-session contracts. A future gateway
implements those contracts over a network transport and owns device pairing,
authentication, rate limits, and audit records. Mobile code only depends on the
remote contracts, never on filesystem paths, model-provider credentials, or
tool implementations.

## v1 scope

- Pair a named device with one trusted workspace host.
- List available workspaces and create or resume agent sessions.
- Send prompts and receive streamed text, task state, tool activity, plans,
  modified-file summaries, and sanitized errors.
- Approve or deny individual tool calls from the phone.
- Interrupt an active run and resume the conversation from its persisted
  session.
- Show a read-only diff/file summary supplied by the host.
- Notify the device when a run completes, fails, or requires approval.

## Explicit non-goals

- Running an agent, shell command, MCP server, or arbitrary workspace action on
  the phone.
- Exposing the host directly to the public internet without a pairing,
  authentication, and transport-security design.
- Sending provider API keys, workspace secrets, or unbounded file contents to
  the mobile device.
- Building a full mobile editor, offline agent runtime, or multi-host routing
  in the first release.

## Milestones

### 1. Remote-session contract

- Add versioned, JSON-safe client commands, host capabilities, session events,
  and command results to `@truss-harness/runtime`.
- Adapt runtime events to the wire-safe event form; errors become messages, not
  serialized `Error` objects.
- Define a transport interface with `execute()`, `events()`, and `close()` so
  WebSocket, SSE, local IPC, and test transports remain interchangeable.
- Add contract tests for event translation and protocol versioning.

### 2. Host gateway and device pairing

- Add a separate host/gateway package rather than networking the runtime
  directly.
- Start with explicit local-network or user-provided tunnel endpoints, TLS, and
  one-time device pairing.
- Store only revocable device/session credentials in platform secure storage.
- Bind every remote session to a workspace and host-side permission policy.
- Add rate limits, connection lifecycle handling, audit records, and token
  revocation before allowing remote access outside a local network.

### 3. Gateway/runtime adapter

- Map remote commands to session creation, runs, interruptions, and tool
  approvals without allowing a client to select arbitrary host paths.
- Stream normalized runtime events with ordered per-session sequence numbers.
- Enforce request-size limits and host-configured attachment allowlists.
- Add diff and workspace-summary endpoints that redact ignored files and secret
  material.

### 4. React Native client

- Create `packages/mobile` with Expo/React Native and strict TypeScript.
- Implement pairing, host selection, session list, streaming chat, run state,
  tool approval, cancellation, and a read-only diff view.
- Use device keychain/keystore APIs for credentials. Never persist workspace
  content or provider credentials by default.
- Add push notifications only after gateway authentication and user consent are
  implemented.

### 5. Quality and release

- Test contract compatibility, replay/out-of-order event handling, reconnect,
  token expiry, revocation, approval denial, and gateway authorization.
- Add end-to-end tests using a disposable workspace host and a transport test
  double.
- Document threat model, deployment modes, pairing recovery, network exposure,
  and privacy limits.

## Decisions required before exposing a gateway

- Pairing mechanism: QR code, one-time code, or authenticated account flow.
- Supported v1 connectivity: LAN only, user-managed tunnel, or hosted relay.
- Whether the first release permits edit-mode approvals or begins in read-only
  chat/plan mode.
- How users discover and revoke paired devices.
- Which mobile push provider and notification metadata are acceptable.

## Acceptance criteria for the first vertical slice

- A transport implementation can connect a client to one configured host
  without importing React Native or a model provider into the runtime.
- A client can create a session, stream a response, receive ordered tool events,
  approve or deny a tool, and interrupt a run.
- The host remains the sole authority for workspace paths, tool permissions,
  credentials, and execution.
- All wire events are JSON-safe and versioned.
- Tests cover remote-event conversion and a rejected or malformed client command.
