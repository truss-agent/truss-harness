# Runtime delivery and client compatibility

**Status:** In progress — host identity and compatibility handshake

**Tracking issue:** #234

## Goal

Allow compatible runtime fixes to be released independently of Desktop, VS
Code, CLI, TUI, Neovim, and Mobile application releases. Preserve local-first
operation, explicit user control, and a safe fallback when an update cannot be
verified or applied.

## Constraint to solve

Today clients import `@truss-harness/runtime` at an exact version and several
clients bundle it into a native or extension artifact. Publishing a newer npm
runtime package does not alter an installed Desktop app, VSIX, or APK. Merely
changing dependencies to a semver range would therefore be misleading and
could make installs non-reproducible.

A one-time client bootstrap release is required. After that release, compatible
runtime updates can be delivered through a separately versioned, verified
runtime host without rebuilding every UI surface.

## Target architecture

```text
Client UI (Desktop / VS Code / CLI / TUI / Neovim / Mobile)
  | stable, versioned host protocol
  v
Runtime bootstrap + compatibility gate
  | verified local runtime artifact, with embedded fallback
  v
Agent host / shared runtime
```

- The client owns UI, credentials integration, platform permission prompts,
  and its embedded fallback runtime.
- A separately versioned runtime host owns agent execution, tools, context,
  provider adapters, and protocol implementation.
- A client may opt into a newer runtime only when both sides agree on a
  protocol compatibility range and the artifact passes integrity checks.
- Mobile remains a remote client: its trusted gateway host performs the same
  compatibility handshake. No downloadable executable runs on the phone.

## Delivery model

1. Define a stable host protocol version and a capability manifest including
   minimum/maximum compatible client protocol versions.
2. Ship a bootstrap in each client once. It resolves a selected runtime host in
   this order: explicitly configured local host, verified managed runtime,
   then the existing embedded implementation.
3. Publish runtime-host artifacts and a signed/checksummed release manifest.
   Do not execute arbitrary downloaded JavaScript or silently replace code.
4. Offer explicit update states: available, compatible, incompatible, invalid
   artifact, and offline. The client keeps using its known-good fallback if an
   update fails.
5. Support rollback by retaining the last known-good runtime version and
   recording activation metadata without credentials or workspace contents.

## Compatibility rules

- Protocol changes are additive within a major protocol version.
- A runtime must advertise all optional capabilities; clients feature-detect
  rather than infer support from package versions.
- Breaking protocol changes require a new client bootstrap release and must
  never be auto-selected.
- Runtime package versions remain exact in source release builds. The delivery
  resolver, not npm's dependency solver, controls installed runtime selection.
- Existing clients keep their current behavior until their one-time bootstrap
  release is installed.

## Work items

1. Inventory every client/runtime boundary and define a small JSON-safe host
   handshake (`protocolVersion`, compatibility range, capabilities, build ID).
2. Extract/standardize a long-lived agent-host process entrypoint using the
   existing protocol contracts; keep it testable without any client UI.
3. Build the resolver, manifest validation, checksums/signature verification,
   activation/rollback metadata, and deterministic fallback behavior.
4. Add the bootstrap adapters for Desktop, VS Code, CLI/TUI, Neovim, and the
   gateway used by Mobile; use staged rollouts rather than a simultaneous
   rewrite.
5. Add offline, corrupt artifact, incompatible protocol, downgrade, and
   rollback tests. Document what is updated, what is never downloaded, and how
   a user disables managed updates.

## Implementation checkpoint 1

The existing `truss-cli serve` JSONL service is the first runtime-host target.
This checkpoint makes its runtime identity and supported client protocol range
explicit in the initialize response. Existing clients ignore the additive data;
new bootstraps must require a compatible handshake before selecting an external
runtime. No client will download or execute a new artifact in this checkpoint.

The VS Code adapter now performs that handshake before creating a user session.
An explicitly configured external `truss-cli` must identify a compatible
runtime; otherwise VS Code reports an actionable error instead of silently
running an unknown executable. Clearing `trussHarness.command` retains the
bundled runtime path. This is the first manual runtime-update path: update the
trusted local CLI, then point the already-installed extension at it.

Neovim performs the same gate for its normal global `truss-cli serve` process.
This gives both editor clients a safe manual update route now, while the later
managed-artifact resolver remains responsible for checksum verification,
activation, and rollback.

## Implementation checkpoint 2

The shared host layer now has a deliberately narrow release-manifest parser,
SHA-256 artifact verification, atomic activation state, and explicit rollback
to the last known-good host. Nothing fetches or starts a managed artifact yet:
clients will first use these guards to verify a user-visible downloaded update,
then the next checkpoint can add authenticated manifest retrieval without
turning a network response into executable code.

## Release sequence

1. Release the host protocol and an embedded-fallback bootstrap for each
   client surface once.
2. Publish the first separately versioned runtime-host artifact and manifest.
3. Verify compatibility/rollback in every client before enabling update
   discovery by default.
4. Thereafter, release runtime-only fixes through the verified host channel
   when the protocol remains compatible; rebuild only clients that need UI,
   native, bootstrap, or breaking-protocol changes.

## Non-goals

- Silent code download or execution without integrity verification.
- Bypassing platform signing requirements for Desktop, VSIX, or Android.
- Updating provider credentials or workspace files as part of runtime update.
- Pretending legacy clients can use an update mechanism they do not contain.
