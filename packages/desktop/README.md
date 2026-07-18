# Truss Desktop

The Truss desktop client is a standalone local-first workspace for Ollama, LM Studio, llama.cpp server, and other OpenAI-compatible local endpoints.

It uses the same TypeScript runtime as the CLI, TUI, and VS Code extension. The Electron main process owns filesystem access, terminals, tools, approvals, local-model configuration, and runtime sessions. The renderer has no Node access and communicates only through a narrow preload bridge.

## Run locally

From the repository root:

```sh
npm install
npm run desktop:dev
```

Open a workspace, select a local endpoint and model in **Settings**, then use the three-pane workspace to browse files, inspect diffs, run terminal commands, and chat with the agent. The collapsible **Git** section above Files shows branch and changed-file state, supports per-file stage/unstage, stage all, commit messages, pull, and push. Agent replies render Markdown with formatted code blocks. Type `/` in chat to fuzzy-search workspace files, select a path with the arrow keys and Enter or Tab, then send the prompt to attach the selected file's bounded contents as context.

## Build and package

```sh
npm --workspace @truss-harness/desktop run build
npm run desktop:package
```

The package command creates a Windows installer under `packages/desktop/release`.

## Security model

The renderer runs with `contextIsolation` enabled and `nodeIntegration` disabled. Filesystem, terminal, Git, provider, and runtime operations are exposed only through explicit IPC handlers in `src/main.ts`.
