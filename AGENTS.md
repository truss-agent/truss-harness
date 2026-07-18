# Project

Build an open-source agent harness similar in capability to Cline, Continue, Roo Code, and OpenHands.

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
