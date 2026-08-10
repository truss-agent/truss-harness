# Project

## Private maintainer notes

Release, publishing, deployment, and contributor-only procedures live in
`admin/repository-operations.md`. The `admin/` directory is Git-ignored and is
intentionally private. Keep the root `README.md` focused on product users:
installation, configuration, client usage, screenshots, and documentation.

## Required change workflow

Every code or documentation change and every push must follow this workflow
without exception. It is a hard rule and cannot be bypassed, shortened, or
treated as optional:

1. Start from an up-to-date default branch and create a fresh dedicated branch.
2. Create an issue from the applicable repository issue template before implementation.
3. Open a pull request from that branch using the pull request template, with a
   closing reference to the issue (for example, `Closes #123`).
4. Complete every applicable template checkbox honestly and wait for required
   checks before merge.

Never commit directly to `master` or `main`; push work without its issue and
dedicated-branch PR; skip the issue; or open an unlinked or incomplete pull
request. The initial branch push required to create a PR is permitted only
after its issue exists, and the PR must be opened immediately afterward. This
workflow protects the repository and is mandatory even for small changes.

## Required release workflow

When a change affects a package or client that must be versioned and rebuilt,
update its version and any required changelog in the same working feature
branch before opening its PR. Never create a separate release or version-bump
branch for work that belongs to an existing change.

After the linked PR is merged and required checks pass, create a clean release
tag from the merged `master` commit when authorized. Never tag an unmerged
feature branch. Coordinate all affected client/package releases from that
merged commit rather than creating extra PRs that consume CI minutes without
shipping product work.

Build a source-available agent harness similar in capability to Cline, Continue, Roo Code, and OpenHands.

The objective is NOT to clone any existing project.

Instead, build a modular framework capable of powering many different frontends.

The first frontend will be a VSCode extension.

---

# Vision

This project should become the "LangChain for coding agents."

Every major subsystem must be replaceable.

Avoid tightly coupling anything to VSCode or any single model provider.

Everything communicates through interfaces.

---

# Project Vision

This is not a VSCode extension with AI features.

This is an agent operating system/runtime that can power many different agent experiences.

The VSCode extension is only the first client.

The long-term goal is to create a universal agent platform where capabilities like:

- model routing
- local/cloud provider selection
- multi-agent workflows
- MCP integrations
- agent plugins
- memory systems
- tool marketplaces
- provider benchmarking

can be added as extensions without modifying the core runtime.

Prioritize building stable interfaces and abstractions over implementing many features quickly.

---

# Core Principles

- TypeScript only
- Strict typing
- Modular architecture
- Plugin based
- Event driven
- Provider agnostic
- Local-first
- Excellent developer experience

Every component should be independently testable.

---

# Initial MVP

The MVP should support:

✓ Chat

✓ Multiple conversations

✓ Streaming tokens

✓ Tool calling

✓ Read files

✓ Write files

✓ Search files

✓ Grep

✓ Terminal execution

✓ Diff previews

✓ Apply patches

✓ Approval workflow

✓ Conversation history

✓ Interrupt generation

✓ Resume generation

✓ Checkpoint state

---

# Model Providers

Design a Provider interface.

Support:

- Ollama
- LM Studio
- llama.cpp server
- OpenAI
- Anthropic
- OpenRouter
- Gemini

Adding a provider should require under 200 lines of code.

---

# Agent Runtime

The runtime is responsible for:

Planning

Reasoning

Context building

Memory

Tool execution

Streaming

Retries

Interruptions

Checkpoint recovery

The runtime should not know it is running inside VSCode.

---

# Tool System

Implement a plugin registry.

Each tool exposes:

- schema
- description
- execute()

Examples:

ReadFile

WriteFile

ListDirectory

Search

Grep

RunTerminal

GitStatus

GitCommit

GitDiff

WebSearch

Diagnostics

LSP symbols

Future tools should load automatically.

---

# Context Manager

Implement intelligent context selection.

Avoid sending entire repositories.

Prioritize:

currently open files

recent edits

git diff

symbol dependencies

imports

errors

diagnostics

conversation history

Compress older context automatically.

---

# Memory

Implement:

Conversation memory

Workspace memory

Project summaries

Vector memory (future)

Checkpoint snapshots

---

# Planning

Support iterative execution.

Example:

Goal

↓

Plan

↓

Execute tool

↓

Observe

↓

Update plan

↓

Continue

Agents should recover from failed tool calls automatically.

---

# VSCode Extension

Responsibilities:

UI

Authentication

Settings

Diff preview

Approval dialogs

Status bar

Notifications

Everything else belongs in the runtime.

---

# Architecture

packages/

runtime/

providers/

tools/

memory/

planner/

context/

vscode/

shared/

sdk/

---

# Code Quality

No singleton services.

Dependency injection.

Interfaces everywhere.

100% TypeScript.

ESLint

Prettier

Vitest

CI from day one.

---

# Future Features

Multi-agent orchestration

Remote execution

Docker sandboxes

Browser automation

MCP support

A2A

Voice

Image understanding

Tree-sitter indexing

LSP integration

Long-term memory

Model routing

Automatic provider benchmarking

Distributed agents

Fine-grained permission system

Marketplace

Plugin ecosystem

Session replay

Telemetry (optional)

Offline mode

---

# Never Do

Never assume OpenAI.

Never hardcode providers.

Never hardcode prompts.

Never couple business logic to VSCode.

Never let tools call each other directly.

Never put planning logic inside UI components.

Keep every subsystem replaceable.

<!-- truss-harness:workspace-context:start -->
## Generated Workspace Context

This block is generated by `/init` from Truss. Refresh it after structural changes; keep project-specific instructions outside these markers.

### Detected Stack

- Languages: TypeScript, JavaScript
- Files scanned: 80

### Top-Level Directories

- `.cred/`
- `.github/`
- `.test-workspaces/`
- `.vscode/`
- `admin/`
- `assets/`
- `packages/`
- `plans/`
- `scripts/`
- `.cred/checkpoints/`
- `.cred/lineage/`
- `.github/ISSUE_TEMPLATE/`
- `.github/workflows/`
- `assets/brand/`
- `packages/agent-host/`
- `packages/branding/`
- `packages/cli/`
- `packages/codex-app-server/`
- `packages/desktop/`
- `packages/docs/`
- `packages/gateway/`
- `packages/mcp/`
- `packages/mobile/`
- `packages/neovim/`
- `packages/provider-openai-compatible/`
- `packages/runtime/`
- `packages/tui/`
- `packages/vscode/`
- `packages/agent-host/src/`
- `packages/branding/src/`
- `packages/cli/scripts/`
- `packages/cli/src/`
- `packages/codex-app-server/src/`
- `packages/desktop/assets/`
- `packages/desktop/release/`
- `packages/desktop/scripts/`

### Packages

- `truss-harness`
- `@truss-harness/agent-host`
- `@truss-harness/branding`
- `@truss-harness/cli`
- `@truss-harness/desktop`
- `@truss-harness/docs`
- `@truss-harness/gateway`
- `@truss-harness/mcp`
- `@truss-harness/mobile`
- `truss.nvim`
- `@truss-harness/provider-openai-compatible`
- `@truss-harness/runtime`
- `@truss-harness/tui`
- `truss-harness-vscode`

### Useful Package Scripts

- `package.json: build`
- `package.json: build:fresh`
- `package.json: test`
- `package.json: test:watch`
- `package.json: lint`
- `package.json: format`
- `package.json: format:check`
- `package.json: quality`
- `package.json: cli:local`
- `package.json: tui:local`
- `package.json: desktop:dev`
- `package.json: mobile:start`
- `package.json: desktop:package`
- `package.json: desktop:package:win:all`
- `package.json: desktop:package:win:x64`
- `package.json: desktop:package:win:arm64`
- `package.json: desktop:package:linux:x64`
- `package.json: desktop:package:linux:arm64`
- `package.json: web:dev`
- `package.json: web:build`
- `package.json: brand:sync`
- `package.json: package:npm`
- `package.json: package:vscode`
- `package.json: release:check`
- `package.json: docs:dev`
- `package.json: docs:build`
- `package.json: docs:build:isolated`
- `packages/agent-host/package.json: build`
- `packages/agent-host/package.json: prepack`
- `packages/agent-host/package.json: prepublishOnly`
- `packages/branding/package.json: build`
- `packages/branding/package.json: prepublishOnly`
- `packages/cli/package.json: build`
- `packages/cli/package.json: postinstall`
- `packages/cli/package.json: prepack`
- `packages/cli/package.json: prepublishOnly`

### Working Rules

- Read the closest `AGENTS.md` before changing code.
- Keep edits scoped, run the relevant tests, and update durable workspace memory with `/update` after meaningful work.
<!-- truss-harness:workspace-context:end -->
