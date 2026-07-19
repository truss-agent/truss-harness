# Truss Desktop

The Truss desktop client is a standalone local-first workspace for Ollama, LM Studio, llama.cpp server, and other OpenAI-compatible local endpoints.

It uses the same TypeScript runtime as the CLI, TUI, and VS Code extension. The Electron main process owns filesystem access, terminals, tools, approvals, local-model configuration, and runtime sessions. The renderer has no Node access and communicates only through a narrow preload bridge.

## Install and use

Download the package for your operating system and CPU architecture from a Truss release:

| Platform | x64 / AMD64 | ARM64 |
| --- | --- | --- |
| Windows | NSIS `.exe` | NSIS `.exe` |
| General Linux | `.AppImage` | `.AppImage` |
| Debian, Ubuntu, Mint | `.deb` | `.deb` |
| Fedora, RHEL, openSUSE | `.rpm` | `.rpm` |
| Arch Linux, Manjaro | pacman package | pacman package |

On Linux, make an AppImage executable before launching it:

```sh
chmod +x Truss-*.AppImage
./Truss-*.AppImage
```

Install native packages with `apt install ./file.deb`, `dnf install ./file.rpm`, or `pacman -U ./file.pacman` as appropriate. Then start a local model server, open a workspace, select the endpoint and model in **Settings**, and choose a mode and permission policy.

The three-pane workspace supports a hierarchical file tree, multiple editor tabs, syntax-highlighted source previews, image and video previews, Git diffs, a workspace command terminal, persisted chat, plans, approvals, context and speed metrics, and optional public internet research. The collapsible **Git** section supports stage, unstage, generated commit messages, commit, pull, and push. Type `/` in chat to fuzzy-search and attach workspace files.

## Security model

The renderer runs with `contextIsolation` enabled and `nodeIntegration` disabled. Filesystem, terminal, Git, provider, and runtime operations are exposed only through explicit IPC handlers in `src/main.ts`.

## Release builds

Create one package locally:

```sh
npm run desktop:package:win:x64
npm run desktop:package:win:arm64
npm run desktop:package:linux:x64
npm run desktop:package:linux:arm64
```

Linux packages must be built on Linux. The `desktop-release.yml` GitHub Actions workflow uses native Windows, Linux x64, and Linux ARM64 runners. A manual workflow run stores downloadable Actions artifacts. Pushing a version tag such as `v0.2.0` also creates a GitHub Release, uploads every package, and generates `SHA256SUMS.txt`.

Windows installers are unsigned until a certificate is supplied to Electron Builder through `CSC_LINK` and `CSC_KEY_PASSWORD`.
