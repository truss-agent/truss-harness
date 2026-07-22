# Truss Desktop

The Truss desktop client is a standalone local-first workspace for Ollama, LM Studio, llama.cpp server, other OpenAI-compatible local endpoints, and optional BYOK cloud providers.

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

The Settings dialog also accepts an `mcpServers` JSON object for local stdio MCP servers. Agent mode loads enabled servers, Plan mode loads only servers marked `readOnly`, and MCP tool calls use the normal approval policy.

## Bring your own key

Settings are split into **Local provider**, **BYOK**, and **Other** tabs. In **BYOK**, choose OpenAI, Anthropic, OpenRouter, Groq, Together AI, Gemini, xAI, Mistral AI, DeepSeek, Perplexity, Fireworks AI, or NVIDIA NIM; enter its model ID and API key; then select **Apply**. The Desktop app encrypts the key with Electron secure storage before writing its local credential record. The regular desktop state file stores only provider and model configuration. Enter a new key to replace it, or use **Remove stored provider key** to delete it.

## Themes

The **Other** tab includes the default Truss palette plus Blue, Orange, and Multicolor presets. Choosing a preset saves it immediately and Desktop restores it on startup. Choose **Custom** to provide any subset of these `#RRGGBB` JSON tokens: `background`, `surface`, `panel`, `border`, `text`, `muted`, `accent`, `accentText`, `warning`, and `error`. Preview changes while editing, then select **Save custom theme** to persist them.

The three-pane workspace supports a hierarchical file tree, multiple editor tabs, syntax-highlighted source previews, image and video previews, Git diffs, a workspace command terminal, persisted chat, plans, approvals, context and speed metrics, and optional public internet research. The collapsible **Git** section supports stage, unstage, generated commit messages, commit, pull, and push. Type `/` in chat to fuzzy-search and attach workspace files.

The terminal accepts both ordinary shell commands and Truss workspace commands. Enter `/help`, `/status`, `/init`, `/update [note]`, or `/clear-memory` directly; slash commands run locally through Truss rather than being sent to the operating-system shell.

## Updates

Installed Windows and Linux x64 AppImage builds check the latest stable GitHub release when **Check for updates when Truss starts** is enabled in Settings. This preference is on by default. Enable **Automatically download available updates** for background downloads, or use **Check now** and **Download** manually. Choose **Restart to update** when the update is ready.

Debian, RPM, pacman, and Linux ARM64 packages are updated through their installer or package manager. Development builds intentionally do not check for updates.

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

Before creating the tag, update the desktop package version and commit it:

```sh
npm version 0.2.0 --workspace @truss-harness/desktop --no-git-tag-version
git add packages/desktop/package.json package-lock.json
git commit -m "chore(desktop): release 0.2.0"
git tag -a v0.2.0 -m "Truss Desktop 0.2.0"
git push origin HEAD
git push origin v0.2.0
```

The release workflow rejects tags that do not match the version in `packages/desktop/package.json`.

Windows installers are unsigned until a certificate is supplied to Electron Builder through `CSC_LINK` and `CSC_KEY_PASSWORD`.
