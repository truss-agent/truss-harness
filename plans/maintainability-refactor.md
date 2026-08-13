# Maintainability Refactor Plan

**Status:** In progress — shared layers and Desktop Git checkpoint implemented

**Created:** 2026-08-12

**Tracking issue:** #199

**Starting point:** `packages/runtime`, followed by its composition, transport,
and client layers

**Primary outcome:** Make Truss easier to change and test without changing its
behavior, public package contracts, or provider/client boundaries.

## Progress log

### 2026-08-12 — Runtime checkpoint

Completed locally on `plan/maintainability-refactor`; nothing has been pushed.

- Created tracking issue #199 and committed this measured roadmap.
- Added Runtime architecture and public-API guardrails so later extractions
  cannot silently introduce client/provider dependencies or remove contracts
  consumed by other packages.
- Decomposed `agents.ts` from an 817-line mixed-responsibility module into a
  one-line compatibility barrel plus focused contracts, coordinator,
  validation, profile storage, bounded run history, and write-lease modules.
- Decomposed `agent.ts` from a 305-line mixed execution loop into a one-line
  compatibility barrel plus runtime orchestration, contracts, edit/recovery
  policy, streaming-progress parsing, and tool-execution modules.
- Added direct unit coverage for profile storage, bounded history, write
  leases, edit/recovery policy, progress parsing, and tool execution while
  retaining the existing end-to-end Runtime suites.

Validation at this checkpoint:

- Runtime suite: 18 test files and 70 tests passing.
- Full repository suite: 39 test files and 168 tests passing after both Runtime
  extractions.
- Root build and Runtime package build passing.
- Targeted Biome checks and `git diff --check` passing for changed Runtime
  files.
- Root `npm run quality` remains blocked by 84 pre-existing formatting errors
  outside this refactor's scope; do not mix those unrelated rewrites into this
  branch.

Next checkpoint: begin Phase 2 at the provider/host composition boundary.
`tools.ts` remains intact because its 263 lines are currently cohesive enough
that splitting it would add files without an independently useful ownership
boundary.

### 2026-08-12 — Shared composition checkpoint

- Decomposed the 604-line agent-host entrypoint into a four-line public barrel,
  provider registry/connection handling, hosted runtime composition, and the
  compatibility constructor used by existing single-agent clients.
- Preserved all package-root exports and the existing CLI, Desktop, TUI, and
  multi-agent construction paths.
- Verified all 7 agent-host tests, all 39 repository test files and 168 tests,
  and the complete root build after the extraction.
- Verified Biome on all changed agent-host source modules. The pre-existing
  `index.test.ts` import-order and generator-yield diagnostics remain outside
  this structural commit and should be handled with its eventual test-suite
  reorganization rather than hidden in an unrelated source move.

Next checkpoint: characterize the OpenAI-compatible stream parser and safe
provider-error mapping with direct tests, then split provider contracts,
serialization, transport parsing, discovery, and factories behind a stable
package-root barrel.

### 2026-08-12 — Provider checkpoint

Completed locally on `refactor/provider-openai-compatible` for issue #201;
nothing from this phase has been pushed.

- Replaced the 884-line provider entrypoint with a five-line stable public
  barrel while preserving every package-root export.
- Extracted provider contracts and the cloud-provider catalog, local endpoint
  and context discovery, credential-safe error mapping, OpenAI/Ollama wire
  serialization and tool-call assembly, provider factories and generation
  helpers, and separate OpenAI-compatible and Ollama transport adapters.
- Added direct characterization tests for provider-error secrecy and retry
  metadata, usage normalization, and fragmented tool-call assembly while
  retaining all 24 existing provider integration tests.
- Kept the OpenAI-compatible stream loop with its adapter because its state is
  specific to that transport; the extracted pure wire helpers now contain the
  independently testable parsing and assembly behavior.

Validation at this checkpoint:

- Provider and agent-host focused suites: 4 files and 35 tests passing.
- Provider package build and targeted Biome checks passing.
- Full repository suite: 41 test files and 172 tests passing.
- Root build, roadmap formatting, and `git diff --check` passing.

Next checkpoint: Phase 3 protocol and command boundaries, beginning with the
CLI runtime service only after this provider phase is merged.

### 2026-08-12 — CLI protocol checkpoint

Completed locally on `refactor/cli-runtime-protocol` for issue #203; this
checkpoint is ready for its linked pull request.

- Decomposed the 771-line CLI protocol service while preserving its public
  `protocol.ts` exports and every serialized request, response, and event
  payload.
- Extracted tool-approval ownership, protocol capabilities and runtime-event
  serialization, JSON-RPC wire framing, and the stdio adapter into focused
  modules.
- Isolated active-run/session lifecycle, cancellation, request-ID ownership,
  event forwarding, and shutdown cleanup in `RunRegistry`, leaving
  `RuntimeService` as the readable protocol orchestrator.
- Reduced `protocol.ts` to 462 lines without altering the existing CLI,
  Neovim, Desktop, VS Code, TUI, or Mobile protocol boundary.

Validation at this checkpoint:

- CLI package build and all 16 protocol tests passing during extraction.
- Final root build and full repository suite passing: 41 test files and 172
  tests.
- Targeted Biome checks, roadmap formatting, and `git diff --check` passing.

Next checkpoint: continue the remaining Phase 3 work at the separately risky
CLI entrypoint and gateway boundaries rather than combining them with this
protocol-service review.

### 2026-08-12 — VS Code client checkpoint

Completed locally on `refactor/vscode-client-decomposition` for issue #205.

- Reduced `packages/vscode/src/extension.ts` from 1,888 lines to 435 lines and
  retained it as the activation, registration, and cross-controller
  composition boundary.
- Extracted typed webview/service contracts, JSON-lines runtime transport,
  bounded conversation restoration, model/MCP normalization, workspace
  context, and streamed inline-response ownership.
- Extracted controllers for provider accounts and connection behavior,
  provider commands, managed agents, Truss Go, updates, Git commit-message
  generation, inline completions, workspace commands, and chat runtime/session
  lifecycle.
- Moved the Chat and Agent Control Center documents into a dedicated webview
  presentation module without changing their message protocol or rendered
  behavior, and removed the unused legacy webview implementation.
- Added focused tests for configuration normalization and model pricing,
  conversation bounds and attachment validation, and concurrent inline
  response buffering.
- Bumped the VS Code client to 0.1.22 and updated the public changelog in this
  feature branch so the eventual release does not require a separate version
  PR.

Validation at this checkpoint:

- Full repository suite passing: 44 test files and 180 tests.
- Root build and isolated documentation production build passing.
- VS Code 0.1.22 packaged successfully as a 1.73 MB VSIX containing 66 files.
- Targeted Biome, roadmap/changelog Prettier checks, and `git diff --check`
  passing.

Next checkpoint: decompose the TUI state/process/rendering boundary in a fresh
Phase 4 continuation after this VS Code checkpoint is reviewed and merged.

### 2026-08-12 — TUI client checkpoint

Completed locally on `refactor/tui-client-decomposition` for issue #207.

- Reduced `packages/tui/src/bin.tsx` from 1,931 lines to under 500 while
  retaining it as the process bootstrap and controller-composition boundary.
- Extracted the runtime/session and conversation controller, terminal/process
  controller, workspace file/editor/Git state, keyboard controller,
  layout/focus reducer, display helpers, reusable panels and overlays, and the
  stateless Ink workspace view.
- Preserved existing startup configuration, streaming chat, approvals,
  cancellation, local-model discovery, MCP inspection, agent profiles, file
  search and Git diff, preview URLs, terminal interruption, keyboard focus,
  and compact/wide resize behavior.
- Added focused coverage for transcript formatting, context-window bounds,
  layout and focus transitions, preview URL safety, and filtered workspace
  collection.
- Bumped the TUI package to 0.1.17 and updated the public changelog in this
  feature branch so a release will not require a separate version PR.

Validation at this checkpoint:

- TUI 0.1.17 package build and all 13 focused TUI tests passing.
- Full repository build and suite passing: 48 test files and 190 tests.
- Isolated documentation production build, targeted Biome checks, changelog
  and roadmap formatting, and `git diff --check` passing.
- Interactive local smoke confirmed startup configuration, responsive Ink
  rendering, keyboard focus movement, and clean idle Ctrl+C exit. The
  maintainer should complete the remaining chat, files, Git diff, settings,
  resize, and active terminal-interruption checks before push.

Next checkpoint after merge: begin the Desktop main-process decomposition in
a fresh branch; do not combine Electron main and renderer risk in one review.

### 2026-08-13 — Desktop main-process checkpoint

Completed locally on `refactor/desktop-main-process-services` for issue #209.

- Reduced `packages/desktop/src/main.ts` from 2,927 lines to under 350 while
  retaining it as the Electron bootstrap and service-composition boundary.
- Extracted application-window lifecycle, updates, secure credentials,
  persisted state and configuration normalization, provider settings and
  accounts, runtime/chat sessions, managed agents, Truss Go, workspace
  files/media, Git operations, managed terminal processes, and domain IPC
  registration.
- Kept renderer-facing channel names and payloads stable, and preserved
  startup recovery, update delivery, provider discovery, credential fallback,
  chat cancellation and approvals, managed-agent history, mobile pairing,
  file safety, Git actions, terminal interruption, formatting, and syntax
  checks.
- Added focused coverage for configuration/model metadata, bounded persisted
  state, secure and session-only credentials, workspace path/media behavior,
  and Git status and commit-message helpers.
- Bumped Desktop to 0.1.37 and updated the public changelog on the feature
  branch so a release will not need a separate version-only PR.

Validation at this checkpoint:

- Desktop build and all focused Desktop tests passing.
- Full repository build and suite passing: 53 test files and 201 tests.
- Isolated documentation production build, targeted Biome and Prettier checks,
  and `git diff --check` passing.
- Linux x64 packaging produced the Debian and unpacked application artifacts;
  the remaining RPM/Pacman targets were blocked by the local machine's disk
  quota rather than a source or packaging error.
- Interactive Electron smoke verified startup/shutdown, settings and
  credentials, chat cancellation and approvals, managed agents, workspace
  files, Git actions, and terminal interruption. The initial phone test exposed
  Desktop's random Truss Go port timing out through the LAN path; Desktop now
  uses the shared stable port 4787 with focused startup, conflict, and cleanup
  coverage. Repeat real-device pairing confirmed the Android client connects
  and opens the Desktop-hosted workspace successfully.

Next checkpoint after merge: begin the Desktop renderer decomposition in a
fresh branch; do not combine it with this Electron main-process review.

### 2026-08-13 — Desktop renderer foundation checkpoint

Completed locally on `refactor/desktop-renderer-foundation` for issue #211.

- Routed every renderer IPC operation and event subscription through one typed
  preload-client boundary instead of reaching through the global bridge across
  unrelated UI domains.
- Added an owned renderer state store for persisted Desktop state,
  configuration, credential-storage status, provider model catalogs, and
  conversation/model selectors.
- Extracted custom-theme parsing and application, Markdown block parsing and
  DOM rendering, safe file and external links, code-language aliases and
  highlighting, and pure sidebar pane calculations.
- Rewired the existing renderer without a framework change and preserved all
  channel names, DOM structure, CSS classes, keyboard behavior, and
  renderer-to-main payloads.
- Replaced the remaining placeholder in Git commit-message generation so the
  selected stored BYOK account works alongside local models.
- Exposed persistent tool permissions for each managed-agent profile and
  verified ask, read-only, and unrestricted approval behavior.
- Made the managed-agent creation form, cards, and actions respond to the
  editor surface width without overflowing into the Chat panel.
- Isolated managed-agent plans from the primary chat plan and refreshes the
  file tree and Git automatically after a completed managed run changes files.
- Added 21 focused tests across the new state, IPC, theme, Markdown, layout,
  cloud commit-generation, agent-permission, plan-isolation, and workspace
  refresh boundaries; bumped Desktop to 0.1.38 and Agent Host to 0.1.9 on the
  feature branch.

Validation at this checkpoint:

- Desktop build and all 44 focused Desktop tests passing.
- Targeted Biome checks pass with four unchanged renderer style suggestions;
  Prettier and `git diff --check` pass.
- Full repository build and suite passing: 61 test files and 224 tests.
- Isolated documentation production build passes all 38 generated routes.
- Interactive Electron smoke remains required before push.

Next checkpoint after merge: migrate cohesive renderer vertical domains in a
fresh branch, beginning with settings/provider and layout controllers before
the higher-risk editor, files, chat, Git, and terminal domains.

### 2026-08-13 — Desktop settings and layout controller checkpoint

Completed locally on `refactor/desktop-settings-layout-controllers` for issue
#213.

- Moved center-surface selection, Chat docking/collapse, Git collapse, sidebar
  track management, and every workbench splitter into one layout controller.
- Preserved pointer and keyboard resizing, double-click reset, responsive
  sidebar redistribution, Chat full-size/side-panel transitions, and Agents
  rendering behind a narrow callback boundary.
- Moved provider-account selection, local/BYOK configuration construction,
  provider connection-test inputs, MCP draft mutations and test statuses into
  a settings controller with pure configuration helpers.
- Centralized settings-domain DOM lookup and removed the corresponding global
  settings and layout state from the renderer composition file.
- Reduced `packages/desktop/src/renderer.ts` to 5,177 lines and added focused
  tests for layout state, provider configuration, account selection, MCP JSON
  validation, and MCP draft transitions.
- Bumped Desktop to 0.1.39 and updated the public changelog in the same feature
  branch.

Validation at this checkpoint:

- Desktop build and focused settings/layout tests pass.
- Full repository build and all 233 tests pass; the isolated documentation
  build generates all 38 routes successfully.
- Targeted formatting and `git diff --check` pass. The repository-wide format
  gate retains its existing unrelated baseline failures.
- Interactive Electron smoke passed for settings, provider accounts, model
  discovery, MCP management, center-surface switching, Chat docking/collapse,
  and pane resizing.

Next checkpoint after merge: continue the renderer vertical-domain migration
with the editor and workspace-files controllers before chat, Git, and terminal.

### 2026-08-13 — Desktop editor and workspace-files checkpoint

Completed locally on `refactor/desktop-editor-files-controllers` for issue
#215.

- Moved editor tabs, active selection, file/diff state, persistence filtering,
  workspace restoration, close and removal fallback, and syntax diagnostics
  into a dedicated editor controller.
- Kept the virtual Settings tab out of workspace-file persistence and active
  file/chat context while retaining the existing editor rendering and IPC
  behavior.
- Moved file-tree entries, filtering state, expanded and loaded directories,
  copied-file state, merge normalization, rename/delete directory transitions,
  and traversal-safe file-action path helpers into a workspace-files
  controller.
- Preserved open, save, format, diff, media, file-tree, context-menu,
  workspace-switch, automatic refresh, and keyboard flows while reducing
  `packages/desktop/src/renderer.ts` to 5,067 lines.
- Added eight focused tests for editor selection and persistence, syntax-state
  transitions, file-list merging, directory expansion/loading, copy cleanup,
  and path safety; bumped Desktop to 0.1.40 and updated the public changelog.

Validation at this checkpoint:

- Desktop build and focused editor/files tests pass.
- Full repository build and all 241 tests pass; the isolated documentation
  build generates all 38 routes successfully.
- Targeted formatting and `git diff --check` pass. The repository-wide format
  gate retains its existing unrelated baseline failures.
- Interactive Electron smoke passed for open/edit/save/format/close, tab and
  file/diff switching, syntax indicators, virtual Settings-tab handling, file
  search, directory expansion, context-menu file operations, automatic
  Files/Git refresh, and restored tabs/tree expansion.

Next checkpoint after merge: extract the Desktop chat/conversation controller,
then Git and terminal controllers, in separate reviewable slices.

### 2026-08-13 — Desktop chat and conversation checkpoint

Completed and merged from `refactor/desktop-chat-controller` for issue #217.

- Moved conversation creation, updates, active lookup, deletion fallback, and
  persisted tool-activity restoration into a dedicated chat controller.
- Centralized primary-agent busy/run identity, visible activity status,
  streaming throughput metrics, tool-call expansion state, pending
  attachments, and slash-file selection behind that controller.
- Extracted deterministic fuzzy workspace-file ranking and grounded slash-file
  reference parsing for direct unit coverage while preserving the Files search
  and Chat request payload behavior.
- Preserved chat rendering, Markdown, provider/runtime IPC, approval prompts,
  conversation focus recovery, attachment conversion, and DOM event wiring in
  the renderer composition boundary.
- Added focused coverage for conversation transitions, run lifecycle and
  cancellation, activity and attachment state, slash navigation, ranking, and
  workspace-reference extraction; bumped Desktop to 0.1.41 and updated the
  public changelog in the same feature branch.

Validation at this checkpoint:

- Desktop and root builds pass; all 66 repository test files and 248 tests
  pass, including seven focused chat-controller tests.
- The isolated documentation production build generates all 38 routes.
- Targeted Biome and Prettier checks and `git diff --check` pass; the renderer
  composition file is now under 5,000 lines.
- Interactive Electron smoke covered conversation rendering, streamed output,
  visible activity, file reading, usage display, and Chat controls. That smoke
  also exposed the separate OpenRouter routing gap addressed below.

### 2026-08-13 — OpenRouter tool-routing reliability checkpoint

The Desktop chat-controller smoke test exposed a shared-provider reliability
gap while using `openrouter/auto`: OpenRouter returned pseudo-tool syntax such
as `cmd:default_api:read_file{...}` as ordinary assistant text instead of a
structured `tool_calls` response. Truss correctly did not execute that text,
but the resulting conversation was confusing and unable to use workspace
tools.

Implemented locally on `fix/openrouter-tool-routing` for issue #219:

- When an OpenRouter request includes Truss tools, send the OpenRouter routing
  constraint `provider.require_parameters: true` and an explicit
  `tool_choice: "auto"` so the request is eligible only for backends that
  advertise support for the supplied parameters.
- Keep the behavior provider-specific; do not add OpenRouter routing fields to
  other OpenAI-compatible services.
- Never interpret or execute tool-like assistant text. Only structured tool
  calls from the provider protocol may enter the Runtime tool-execution path.
- Add request-payload coverage for OpenRouter with and without tools and retain
  the existing transport, fragmented-call, malformed-argument, and
  credential-safety tests.
- Verify an explicit tool-capable OpenRouter model and `openrouter/auto` with a
  real read-only workspace tool call, then validate Desktop, VS Code, CLI, TUI,
  Neovim, and Mobile through their shared provider/runtime boundary.
- Version every affected shared package and client in that feature branch and
  coordinate the resulting releases only after its linked PR is merged.

Validation at this checkpoint:

- The complete release check passes: clean root build, all 67 test files and
  251 tests, all 38 documentation routes, eight npm tarballs, and the VS Code
  0.1.23 VSIX.
- Three focused payload tests cover OpenRouter with tools, OpenRouter without
  tools, and a non-OpenRouter compatible provider. They also prove pseudo-tool
  assistant text remains ordinary non-executable text.
- Provider 0.1.13, agent-host 0.1.10, CLI 0.1.21, TUI 0.1.18, VS Code 0.1.23,
  and Desktop 0.1.42 are aligned for the coordinated release.
- A live `openrouter/auto` Desktop smoke completed successfully with a real
  read-only workspace tool call; the routed model used structured tool calling
  and returned the grounded response without leaking pseudo-tool syntax.

### 2026-08-13 — Desktop Git controller checkpoint

Implemented locally on `refactor/desktop-git-controller` for issue #221:

- Moved repository status and graph state, staged-file projection, refresh
  ordering, destructive confirmations, and every Git action into a dedicated
  controller.
- Moved Git panel DOM lookup, repository/history rendering, file-row actions,
  commit form handling, and static event binding into a focused Git view.
- Preserved staging and unstaging, per-file and workspace discard, pull, push,
  commit, generated commit messages, syntax-error indicators, terminal
  feedback, collapse behavior, and automatic Files/Git refresh.
- Reduced `packages/desktop/src/renderer.ts` from 4,960 to 4,575 lines and
  added ten focused tests for state projection, action sequencing, remote and
  confirmation safety, generated messages, status labels, refs, and graph
  lanes.
- Bumped Desktop to 0.1.43 and updated the public changelog in the same feature
  branch.

Validation at this checkpoint:

- Desktop build and all 25 Desktop test files and 78 tests pass.
- Root build and all 69 repository test files and 261 tests pass. The first
  sandboxed run could not bind the gateway test port or start MCP fixtures;
  the identical suite passed with the permissions those tests require.
- The isolated documentation production build generates all 38 routes.
- Targeted Biome and Prettier checks and `git diff --check` pass; the existing
  unrelated renderer style suggestions remain unchanged.
- Interactive Electron smoke passed for status/history rendering, collapse,
  open-file actions, stage/unstage/discard, generated commit messages, commit,
  pull/push safety, and automatic Files/Git refresh.

Next checkpoint after merge: extract the Desktop terminal controller in a
fresh branch, keeping it separate from remaining renderer domains.

## 1. Why this refactor is needed

Several modules have become application subsystems rather than files. Their
size is not the only problem: they combine unrelated responsibilities, make
state ownership difficult to see, and force small changes through large review
surfaces. The highest-risk examples also sit on frequently changed paths.

The refactor must begin at the shared runtime boundary. Extracting client code
before the runtime and host contracts are stable would encourage every client
to invent its own lifecycle, provider, session, and cancellation abstractions.

This plan is deliberately behavior-preserving. Feature work, visual redesigns,
protocol changes, provider additions, and framework migrations should not be
mixed into the structural changes described here.

## 2. Measured baseline

The inventory excludes generated output, `node_modules`, `.next`, and `dist`.
The repository currently contains approximately 32,000 lines of TypeScript,
JavaScript, TSX, and Lua beneath `packages/`.

### Highest-priority production modules

| File | Lines | Current responsibility concentration | Priority |
| --- | ---: | --- | --- |
| `packages/desktop/src/renderer.ts` | 5,580 | UI state, themes, agents, Git, files, editor, settings, chat, terminal, events, resizing | Critical |
| `packages/desktop/src/main.ts` | 2,927 | Electron lifecycle, updates, credentials, runtime, agents, mobile gateway, files, Git, chat, IPC | Critical |
| `packages/tui/src/bin.tsx` | 1,931 | process setup, commands, state, runtime events, all Ink components, all interaction | Critical |
| `packages/vscode/src/extension.ts` | 1,888 | activation, runtime transport, configuration, credentials, commands, agents, gateway, webviews | Critical |
| `packages/cli/src/bin.ts` | 925 | argument parsing, setup wizard, interactive chat, gateway, every command | High |
| `packages/provider-openai-compatible/src/index.ts` | 884 | provider metadata, serialization, streaming, errors, local discovery, generation helpers | High |
| `packages/mobile/App.tsx` | 858 | gateway transport, pairing, remote state, screens, components, styles | High |
| `packages/runtime/src/agents.ts` | 817 | contracts, validation, profile store, write lease, run state, scheduling, history, events, cleanup | First |
| `packages/cli/src/protocol.ts` | 771 | protocol capabilities, requests, sessions, runs, approvals, agent control, lifecycle | High |
| `packages/docs/app/download/download-client.tsx` | 768 | release data, platform detection, asset matching, cards, full download page | Medium |
| `packages/agent-host/src/index.ts` | 604 | provider registry, connection errors, factories, prompts, approval, runtime composition | High |
| `packages/gateway/src/index.ts` | 490 | remote mapping, authorization, HTTP/WebSocket transport, gateway lifecycle | High |

### Runtime-specific baseline

| File | Lines | Finding |
| --- | ---: | --- |
| `agents.ts` | 817 | The first extraction target. `AgentCoordinator` alone is about 413 lines and the file exposes many distinct public contracts. |
| `agents.test.ts` | 570 | Good behavioral coverage, but concurrency, history, lifecycle, cancellation, and profile behavior share one fixture-heavy suite. |
| `agent.ts` | 305 | Not oversized by itself, but the core run loop owns streaming parsing, retries, edit recovery, tool execution, memory, plans, and completion. |
| `agent.test.ts` | 526 | Tests `AgentRuntime`, providers, sessions, context, and tools in one file; it obscures ownership. |
| `tools.ts` | 263 | Registry, filesystem tools, search, grep, terminal execution, and bundle registration are coupled. |
| `web.ts` | 233 | Cohesive enough for now; network policy and web tools should remain together until tests show a useful seam. |
| `commands.ts` | 211 | Cohesive workspace-command subsystem; not an early split target. |
| `context.ts` | 129 | Small and interface-led; retain unless later changes reveal pressure. |
| `contracts.ts` | 127 | Small public contract leaf; protect it rather than split it. |
| `credentials.ts` | 55 | Already focused; no refactor required. |

### Dependency direction today

```text
runtime
  ├─ provider-openai-compatible
  ├─ mcp
  ├─ gateway
  └─ agent-host
       └─ provider + mcp + runtime

cli
  └─ agent-host + gateway + provider + mcp + runtime

desktop / vscode
  └─ cli + agent-host + gateway + provider + mcp + runtime

tui
  └─ cli + provider + runtime

neovim ── local CLI protocol ──> cli/runtime
mobile ── remote gateway protocol ──> gateway/runtime
```

The desired direction stays the same: runtime must remain client-neutral and
provider-neutral. No extraction may introduce a dependency from runtime back
to a host, provider, protocol, or UI package.

## 3. Refactor rules

1. **Preserve behavior before improving behavior.** Initial extraction commits
   move existing logic and tests. Cleanup follows only after the moved code is
   green and reviewable.
2. **Preserve the public package surface.** Existing imports from
   `@truss-harness/runtime` continue to compile. Compatibility barrels remain
   until every consumer is migrated intentionally.
3. **Split by ownership, not arbitrary line count.** A module should own one
   domain concept or one orchestration boundary. Small helper files with no
   independent concept are not a goal.
4. **Keep orchestration visible.** Entrypoints may coordinate services, but
   should not implement those services. Dependency construction should remain
   readable in one place.
5. **Make dependencies explicit.** Extracted services receive stores, clocks,
   ID factories, transports, and event emitters through constructors or typed
   options; do not introduce process-wide singletons.
6. **Keep state near its owner.** UI components should not mutate unrelated
   global state. Runtime run state, transport state, and persisted state must
   have separate owners.
7. **Do not combine refactors with releases or features.** Version affected
   packages as required by repository policy, but do not use a refactor PR to
   add product behavior.
8. **Use few, substantial PRs.** Each phase should normally use one to three
   PRs containing focused commits. Avoid one PR per extracted file and avoid a
   repository-wide rewrite.

### Advisory module limits

These are review triggers, not mechanical quality scores:

- Entry/bootstrap modules should normally stay below 400 lines.
- Domain modules should normally stay below 500 lines.
- A module over 500 lines needs a documented reason and a single cohesive
  responsibility.
- A function or class over 200 lines should be reviewed for separable policy,
  transport, state, or presentation responsibilities.
- New code should not increase a listed monolith unless the same change also
  creates the extraction seam it needs.

## 4. Phase 0 — Baseline and safety rails

### Goal

Establish contract protection before moving shared code.

### Work

1. Record a baseline run of `npm run build`, `npm test`, `npm run lint`, and
   `npm run format:check` before the first implementation PR.
2. Add a compile-time public API contract fixture for
   `@truss-harness/runtime`. It should import the symbols used by agent-host,
   CLI, Desktop, gateway, MCP, provider, TUI, and VS Code so an accidental
   export removal fails CI.
3. Add an architecture check for forbidden dependency directions:
   runtime may import branding and Node APIs, but not provider adapters,
   agent-host, CLI, Electron, VS Code, React, Ink, React Native, or gateway.
4. Capture the line inventory with a small deterministic repository script so
   future plans can compare trends. The script reports; it should not fail CI
   solely because a file crosses a numeric threshold.
5. Document the extraction convention: domain folders expose a local
   `index.ts`, while the package root controls the stable public surface.

### Exit criteria

- Existing public runtime imports are represented by a compile fixture.
- Forbidden runtime dependencies fail a focused test or check.
- Baseline build/test status is known before code movement starts.

## 5. Phase 1 — Runtime first

This phase stabilizes the shared concepts consumed by every primary client.
It should be delivered in two coherent PRs, or one PR if the diff remains easy
to review.

### PR 1A — Decompose managed-agent coordination

Keep `packages/runtime/src/agents.ts` as a compatibility barrel while moving
implementations into an `agents/` domain:

```text
packages/runtime/src/agents/
  contracts.ts          Agent IDs, profiles, run summaries, events, interfaces
  errors.ts             AgentCoordinatorError and stable error codes
  profile-validation.ts profile/provider validation
  profile-store.ts      InMemoryAgentProfileStore
  write-lease.ts        WorkspaceWriteLease and in-memory implementation
  run-output.ts         bounded output accumulation
  run-history.ts        validation, ordering, retention, persistence policy
  coordinator.ts        scheduling and lifecycle orchestration
  index.ts              domain exports
packages/runtime/src/agents.ts  compatibility re-export
```

The exact final grouping should follow cohesion observed during extraction. In
particular, do not create a file for a three-line helper unless it protects a
real policy boundary.

#### Coordinator target shape

`AgentCoordinator` should retain the use-case API:

- profile CRUD delegation;
- start, stop, stop-all, approval resolution, and disposal;
- run lookup and event publication.

Move these policies behind focused collaborators:

- profile validation and storage;
- exclusive workspace write leasing;
- terminal-run history retention/persistence;
- active-run-to-summary projection and bounded output;
- clock and ID generation where deterministic tests benefit.

Scheduling and terminal-state transitions should remain in the coordinator
until a state-machine extraction clearly makes them easier to understand. Do
not hide core lifecycle ordering behind generic abstractions.

#### Test reorganization

Split `agents.test.ts` by behavior while reusing small explicit fixtures:

```text
agents/profile-store.test.ts
agents/coordinator-concurrency.test.ts
agents/coordinator-cancellation.test.ts
agents/coordinator-history.test.ts
agents/coordinator-lifecycle.test.ts
```

Replace timing-based polling where possible with deferred test runtimes,
injected clocks/IDs, and observable lifecycle events. Preserve explicit tests
for the existing cancellation-during-session-creation race, cleanup, write
lease release, event correlation, bounded history, and concurrent slot reuse.

### PR 1B — Decompose the single-agent execution loop

Retain `AgentRuntime` as the public facade and session API. Extract policy from
the loop into an `agent/` domain:

```text
packages/runtime/src/agent/
  contracts.ts          AgentRuntimeOptions and ToolApproval
  progress-stream.ts    <progress> streaming parser
  edit-policy.ts        edit intent, write verification, recovery instructions
  tool-executor.ts      approval, execution, result recording, recovery result
  runtime.ts            provider-neutral turn loop and lifecycle
  index.ts              domain exports
packages/runtime/src/agent.ts  compatibility re-export
```

Keep model retry policy in the existing `retry.ts`; the agent layer consumes
it rather than duplicating it. Keep workspace memory and plans behind their
existing interfaces.

Split `agent.test.ts` so tests live with the concept they protect:

- streaming/progress parsing;
- turn loop and completion;
- edit/write recovery policy;
- tool execution and approval;
- memory and plan recording;
- sessions, context, provider registry, and filesystem tools in their existing
  module suites rather than a catch-all agent suite.

### PR 1C — Tools only if justified by the first two PRs

`tools.ts` is not urgent, but it owns three domains. If runtime work touches it,
split it without changing tool names or schemas:

```text
tools/registry.ts
tools/filesystem.ts
tools/search.ts
tools/terminal.ts
tools/register.ts
tools.ts  compatibility re-export
```

Do not split `context.ts`, `contracts.ts`, `credentials.ts`, `commands.ts`, or
`web.ts` merely to make the files smaller. They are currently cohesive.

### Runtime acceptance criteria

- No consumer import from `@truss-harness/runtime` changes unless explicitly
  documented.
- Runtime has no new dependency on any provider, host, protocol, or client.
- Managed-agent concurrency, cancellation, history, approvals, write leases,
  and cleanup behave exactly as before.
- Single-agent streaming, retries, recovery, tools, memory, and plans behave
  exactly as before.
- Focused runtime tests, full tests, build, lint, and format checks pass.
- Runtime source maps and declarations still point to understandable modules.

## 6. Phase 2 — Shared composition and providers

Begin only after Phase 1 exports and lifecycle behavior are stable.

### `packages/provider-openai-compatible`

Split the 884-line index into:

- `contracts.ts` for provider-specific wire types;
- `openai/messages.ts` and `openai/tools.ts` for serialization;
- `openai/stream.ts` for SSE/JSON accumulation and tool-call assembly;
- `errors.ts` for safe status mapping and retry metadata;
- `openai-compatible-provider.ts`;
- `ollama-provider.ts`;
- `discovery.ts` for endpoint/model/context detection;
- `factories.ts` for public creation and generation helpers;
- `index.ts` as the stable public barrel.

The transport parser and safe error mapping need direct tests before moving
the provider classes. Provider IDs, defaults, request shapes, error messages,
and environment credential behavior must not change in this phase.

### `packages/agent-host`

Split the 604-line composition root into:

- provider registry and metadata;
- provider connection error mapping;
- local/cloud provider factories;
- prompt/mode policy;
- approval-controller adapter;
- `AgentHost` runtime composition;
- compatibility `createHostedRuntime` facade.

`AgentHost` remains the composition boundary that is allowed to know runtime,
providers, tools, credentials, and MCP. Runtime must never absorb this work.

### `packages/mcp`

At 293 lines it is not an immediate size problem. Extract transport/process
lifecycle only if Phase 2 changes make that ownership clearer. Preserve MCP's
role as a tool adapter rather than a second agent runtime.

### Phase 2 exit criteria

- OpenAI-compatible and Ollama tests cover identical request, stream, error,
  retry, discovery, and credential behavior before and after extraction.
- Agent-host remains the only shared composition layer.
- Consumers still use stable package-root exports.

## 7. Phase 3 — Protocol and command layers

### CLI service protocol

Break the 590-line `RuntimeService` in `cli/src/protocol.ts` into typed request
handlers with one session/run registry:

```text
protocol/contracts.ts       existing versioned wire contracts
protocol/validation.ts      existing validation
protocol/capabilities.ts
protocol/request-router.ts
protocol/session-handler.ts
protocol/run-handler.ts
protocol/agent-handler.ts
protocol/approval-handler.ts
protocol/service.ts          lifecycle and shared registries
protocol/stdio.ts            JSON-RPC/JSON-lines transport
```

Protocol versions and serialized payloads are compatibility boundaries for
VS Code and Neovim. Add fixture-based request/response tests before moving
handlers. No wire field may change as an incidental refactor.

### CLI entrypoint

Split `cli/src/bin.ts` into argument parsing, setup, interactive chat, gateway
command, agent command, MCP command, and a small `main`. Command help and exit
codes are user-facing contracts and need snapshot or table-driven tests.

### Gateway

Split gateway authorization and mapping from HTTP/WebSocket transport:

- remote profile/run mapping;
- capability/action authorization;
- connection registry and sequencing;
- HTTP pairing endpoints;
- WebSocket session transport;
- gateway lifecycle/bootstrap.

Mobile and Neovim do not import runtime directly, but their protocols depend
on this phase. Preserve protocol versions and capability negotiation.

## 8. Phase 4 — Client decomposition

Client work follows shared-layer stabilization. Each client should keep one
small composition entrypoint and divide stateful domains behind typed APIs.

### VS Code

Target `extension.ts` first among graphical clients because it is smaller than
Desktop and exercises the same runtime/agent contracts.

Proposed domains:

- extension activation and registration;
- runtime service transport;
- model/provider configuration and secret storage;
- conversation controller and persistence;
- managed-agent control center;
- Truss Go gateway controller;
- Git commit-message command;
- workspace commands/context;
- chat webview protocol;
- webview markup, styles, and script assets.

The `activate()` function should compose controllers and register disposables;
it should not implement their behavior. Webview messages must use shared typed
contracts rather than untyped strings duplicated across extension and script.

### TUI

Split the 1,500-line `App` by state ownership rather than visual fragments:

- runtime/session hook;
- conversation state hook;
- provider/settings controller;
- terminal/process controller;
- file browser and Git state;
- layout/focus reducer;
- Chat, Files, Git, Terminal, Settings, and status components.

Use a reducer for related layout/focus transitions instead of adding more
independent booleans. Keep Ink rendering separate from process and runtime
side effects.

### Desktop main process

Turn `main.ts` into a composition root with services for:

- application lifecycle and window creation;
- updates;
- secure credentials and provider accounts;
- persisted application/workspace state;
- runtime and managed-agent lifecycle;
- Truss Go gateway;
- workspace files/media;
- Git operations;
- chat execution/context;
- IPC registration by domain.

IPC handlers should be thin adapters that validate input, call one service,
and serialize a result. Domain services should be testable without launching
Electron.

### Desktop renderer

This is the largest and riskiest refactor. Do it incrementally without a UI
framework rewrite. Establish a typed renderer store and domain controllers,
then move one vertical domain at a time:

```text
renderer/
  state/              normalized application state and selectors
  ipc/                typed bridge event/command adapters
  theme/
  agents/
  git/
  files/
  editor/
  settings/
  chat/
  terminal/
  layout/
  markdown/
  bootstrap.ts
```

Each domain owns its DOM lookup, rendering, event binding, and state actions.
Cross-domain behavior goes through typed actions or narrow controller methods,
not direct mutation of another domain's elements. Preserve focus, resizing,
settings-tab, file-menu, terminal interruption, chat docking, and syntax-error
behavior with focused tests before moving those sections.

### Mobile

Split gateway transport/pairing from remote workspace state and presentation:

- gateway client and event sequencing;
- pairing persistence;
- remote workspace reducer;
- connection/workspace screens;
- agent/chat/approval components;
- styles and theme tokens.

### Documentation downloads

Separate release/API data normalization, platform/package selection, Desktop
card, generic client card, and page composition. Keep the existing
release-selection tests and add component-level cases only where behavior is
currently embedded in the 768-line component.

## 9. Delivery order and PR budget

| Order | Phase | Expected PRs | Why |
| ---: | --- | ---: | --- |
| 1 | Baseline + runtime managed agents | 1 | Protect exports, then remove the most concentrated shared-runtime module. |
| 2 | Runtime execution loop and optional tools split | 1 | Stabilize run/tool policy before consumers move. |
| 3 | Provider + agent-host composition | 1–2 | Establish clean provider/host seams. |
| 4 | CLI protocol + CLI entry + gateway | 1–2 | Protect wire compatibility used by Neovim, VS Code, and mobile. |
| 5 | VS Code + TUI | 1–2 | Prove client-facing seams on smaller clients. |
| 6 | Desktop main | 1 | Extract testable host services before renderer work. |
| 7 | Desktop renderer | 2–3 | Move vertical domains in reviewable groups without a rewrite. |
| 8 | Mobile + documentation downloads | 1–2 | Finish remaining monoliths using stable transport/data contracts. |

This is an estimated 9–14 substantial PRs across the whole repository, not a
PR per file. Every PR must leave the branch buildable and preserve the current
user experience.

## 10. Commit strategy inside each PR

1. Add or relocate contract tests without changing production behavior.
2. Move one cohesive responsibility with compatibility re-exports.
3. Rewire the original composition root to the extracted module.
4. Remove dead duplication only after all consumers use the new owner.
5. Apply local naming/format cleanup in a final focused commit.

Avoid commits that mix file movement with unrelated formatting; they hide the
semantic diff and make regressions harder to review.

## 11. Validation matrix

Every phase runs root checks plus the affected package/client checks.

| Layer | Required validation |
| --- | --- |
| Runtime | focused runtime tests, runtime build, root `npm test`, root `npm run build`, lint, format check |
| Provider/host | provider and agent-host tests, provider preflight/model discovery smoke checks, package builds |
| CLI/protocol/gateway | protocol fixtures, CLI command tests, gateway authorization/pairing tests, CLI/TUI local smoke |
| VS Code | extension build, VSIX packaging, Extension Host smoke for chat, cancellation, concurrent conversations, settings, and agents |
| TUI | build plus interactive terminal smoke for chat, files, Git, terminal interruption, focus, and resize |
| Desktop main | Electron build plus IPC/service tests and startup/shutdown smoke |
| Desktop renderer | build plus focused DOM/state tests and manual Linux smoke of every moved domain |
| Mobile | TypeScript/Expo checks and real-device pairing/reconnect/chat/approval smoke |
| Docs | isolated docs build and responsive download-page verification |

For package/client changes, update versions and required changelog entries on
the same working branch before its PR, following repository release policy.

## 12. Risk controls

| Risk | Control |
| --- | --- |
| Accidental public API break | Compile fixture, compatibility barrels, declaration build, consumer builds. |
| Runtime lifecycle regression | Preserve event-order tests; use deferred fake runtimes for cancellation and cleanup races. |
| Protocol incompatibility | Fixture serialized messages and capability versions before handler extraction. |
| UI state/focus regression | Move one domain at a time; add state/controller tests; run manual focus and concurrency smoke checks. |
| Hidden circular dependency | Enforce package direction and domain import rules; keep root barrels out of internal imports. |
| Too many tiny abstractions | Require each extracted module to own a named domain concept, policy, service, or adapter. |
| Refactor stalls feature delivery | Keep phases independently mergeable and pause only at stable boundaries. |
| Review becomes unreadable | Separate test, move, rewire, and cleanup commits; avoid global formatting churn. |

## 13. Definition of done

The maintainability program is complete when:

- runtime coordination and execution policies have focused owners and tests;
- shared package exports and remote protocols remain compatible;
- client entrypoints are composition roots rather than application
  implementations;
- the listed critical monoliths have been decomposed into cohesive domains;
- no new cross-layer dependency violates provider/client neutrality;
- all automated checks and client smoke tests pass after each phase;
- contributors can locate the owner of runtime, provider, protocol, state, and
  UI behavior without reading a multi-thousand-line module.

## 14. First implementation checkpoint

The first implementation PR should stop after Phase 0 and PR 1A:

1. protect the public runtime surface;
2. split managed-agent contracts, profile storage, write lease, history, and
   coordination behind the existing `agents.ts` export;
3. reorganize the managed-agent tests and remove timing-sensitive waits where
   practical;
4. run the full validation gate;
5. report before/after module sizes and confirm zero consumer import changes.

That checkpoint produces immediate maintainability value while keeping the
highest-risk `AgentRuntime` execution loop unchanged until the coordinator
extraction is proven stable.
