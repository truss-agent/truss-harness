# Truss for VS Code

<p align="center"><img src="./media/truss-harness.png" width="96" alt="Truss logo"></p>

Truss is a local-first coding-agent side panel for VS Code. It connects to Ollama, LM Studio, llama.cpp server, and custom OpenAI-compatible local endpoints through the Truss runtime service. It does not require a cloud provider account.

## Install

From the Marketplace, install **Truss** and then install the companion CLI:

```sh
npm install -g @truss-harness/cli
```

Open the Truss icon in the Activity Bar. In **Settings**, select a detected local server or enter an endpoint, refresh models, and set the context window and permission policy. Use the bottom control bar to switch models and agent modes during a session. Agent responses render Markdown and formatted code blocks. Type `/` in the chat composer to fuzzy-search workspace files; choose a file with arrow keys and Enter or Tab to attach its bounded contents to the next prompt.

For local development, build the repository, open it in VS Code, and run **Run Truss Extension** from **Run and Debug**. The Extension Development Host automatically uses the workspace CLI build instead of a global installation.

```sh
npm install
npm run build
```

## Side panel

The side panel contains:

- Conversation history with per-conversation delete controls and live streaming chat
- Local server, endpoint, context-window, and permission controls
- Bottom controls for Chat, Plan, and Agent modes plus the active local-model dropdown
- Tool approval prompts
- A stop-generation control
- Source Control title-bar action that generates a commit message from staged or unstaged Git changes and fills Git's commit-message input
- A Help button for deterministic workspace commands

Conversation transcripts are stored in VS Code workspace state. They remain available after closing or reloading the panel and across extension restarts. Use the `x` control beside a conversation to delete it. The live runtime session itself is recreated on demand from the saved user/assistant transcript, so provider state is not treated as durable storage.

Changing the bottom model dropdown restarts the Truss runtime with the selected model. For Ollama endpoints, Truss also makes a best-effort request to release the previous model from memory; compatible servers select the new model on the next request according to their own server lifecycle.

Modes govern the agent's available tools:

| Mode | Access |
| --- | --- |
| Chat | Chat only; no workspace tools. |
| Plan | Read, list, search, and grep. |
| Agent | Full registered tools, including writes and terminal commands. |

Permissions apply after the selected mode:

| Permission | Behavior |
| --- | --- |
| Ask every time | Require Allow/Deny for every tool call. |
| Auto-allow read-only | Allow read, list, search, and grep; prompt for writes and terminal commands. |
| Auto-allow all | Allow every registered tool. Use only in a trusted workspace. |

## Workspace commands

Type these directly in the chat composer. They are executed locally, not sent to the model, so they also work without a selected model.

| Command | Result |
| --- | --- |
| `/init` | Scans the repository and creates or refreshes Truss's managed workspace-context block in `AGENTS.md`, preserving any existing instructions. |
| `/update [note]` | Stores current Git state and an optional progress note in `.truss-harness/agent-state.json`. |
| `/status` | Shows the current Git state and recent durable task records. |
| `/clear-memory` | Deletes the workspace-local durable memory file. |
| `/help` | Displays the slash-command list. |

The Command Palette exposes the same maintenance actions as **Truss: Initialize Workspace Instructions**, **Update Workspace Memory**, **Show Workspace Status**, and **Clear Workspace Memory**.

## Inline completions

Truss registers VS Code inline completions for editor documents. When a completion is available, accept it with the normal editor inline-completion binding, usually `Tab`. Keep a small local model responsive by using a dedicated coding model and a local server with native tool calling enabled.

## Settings

| Setting | Purpose |
| --- | --- |
| `trussHarness.command` | Path to the globally installed `truss-cli` executable used outside development. |
| `trussHarness.model` | Optional model identifier fallback. The panel's workspace state takes precedence. |
| `trussHarness.baseUrl` | Optional local endpoint fallback. The panel's workspace state takes precedence. |

## Package for the Marketplace

The extension is bundled before packaging so its runtime dependencies are included. From this package directory, run:

```sh
npm run package
```

This produces a `.vsix` file for local installation or Marketplace submission. Set the final `publisher`, `name`, version, repository links, and a PNG Marketplace icon before publishing under an organization account.
