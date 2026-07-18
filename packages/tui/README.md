# Truss TUI

<p align="center"><img src="./logo.png" width="96" alt="Truss logo"></p>

The Truss TUI is a full-screen terminal workspace for local coding models. It includes a file tree, editor and Git diff preview, agent chat, shell output, tool approvals, local-model selection, and workspace commands.

## Install and run

```sh
npm install -g @truss-harness/tui
truss-harness-tui
```

The TUI reads the same `.truss-harness/config.json` profiles as `@truss-harness/cli`, or lets you select a detected Ollama, LM Studio, llama.cpp, or custom compatible endpoint at startup.

## Controls

| Key | Action |
| --- | --- |
| `Tab` | Move between files, editor, chat, and terminal panes. |
| `Enter` | Send the chat input or open the selected file. |
| `m` | Open local model settings outside the chat pane. |
| `d` | Toggle the selected file's Git diff. |
| `!` | Open a workspace shell command prompt from the terminal pane. |
| `?` | Open workspace command help. |
| `Esc` | Stop generation. |
| `Ctrl+C` | Stop generation, or exit while idle. |

Type `/init`, `/update [note]`, `/status`, `/clear-memory`, or `/help` into the Agent pane. They run locally without a model call. Approvals for model-initiated tools still respect the selected permission policy.
