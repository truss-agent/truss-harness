# Truss TUI

<p align="center"><img src="./logo.png" width="96" alt="Truss logo"></p>

The Truss TUI is a full-screen terminal workspace for local coding models. It includes a collapsible directory-first file tree, fuzzy file search, syntax-highlighted editor and Git diff preview, agent chat, shell output, tool approvals, local-model selection, and workspace commands.

## Install and run

```sh
npm install -g @truss-harness/tui
truss-tui
```

Run `truss-tui --help` for a non-interactive launch reference. Inside the TUI, press `?` for the complete keyboard-control reference.

The TUI reads the same `.truss-harness/config.json` profiles as `@truss-harness/cli`, or lets you select a detected Ollama, LM Studio, llama.cpp, or custom compatible endpoint at startup.

Configured MCP stdio servers are connected when an Agent session starts, and their connection status appears in the Terminal pane. Plan mode loads only servers explicitly marked `readOnly`. Run `truss-cli config path` to locate the shared user and workspace configuration files.

## Controls

| Key | Action |
| --- | --- |
| `Tab` / `Shift+Tab` | Move forward or backward between panes. |
| `Ctrl+Left` / `Ctrl+Right` | Move to the adjacent pane without cycling forward through every pane. |
| `/` | Fuzzy-search workspace files from the Files pane. |
| `Enter` | Send the chat input or open the selected file. |
| `Left` / `Right` | Collapse or expand the selected directory. |
| `m` | Open local model settings outside the chat pane. |
| `d` | Toggle the selected file's Git diff. |
| Type directly | Enter a command while the terminal pane has focus. |
| `?` | Open workspace command help. |
| `Esc` | Stop generation. |
| `Ctrl+C` | Stop generation, or exit while idle. |

Type `/init`, `/update [note]`, `/status`, `/clear-memory`, or `/help` into the Agent pane. They run locally without a model call. Approvals for model-initiated tools still respect the selected permission policy.
