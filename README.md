# Truss

<p align="center"><img src="assets/brand/logo.svg" width="112" alt="Truss logo"></p>

Truss is a local-first, provider-neutral runtime for coding agents. It currently ships a reusable runtime, native Ollama adapter, OpenAI-compatible local server adapter, CLI, terminal UI, VS Code client, and standalone desktop client.

The project is in active development. The recommended way to use it today is from this repository against a local model server.

## Build and Ship Everything

Truss has four independently shipped products:

| Product | Distribution | Release trigger |
| --- | --- | --- |
| CLI and TUI | Public npm packages | Manual `npm publish` |
| Desktop app | GitHub Release installers | Pushed `v*` Git tag |
| VS Code extension | VS Code Marketplace or `.vsix` | Manual `vsce publish` |
| Website and docs | Next.js hosting provider | Manual or provider deployment |

The reusable npm dependencies must also be published because the CLI and TUI
reference them as normal package dependencies.

### Complete Release Check

From a clean checkout with Node.js 20 or newer:

```sh
npm ci
npm run brand:sync
npm run release:check
```

`release:check` performs a fresh TypeScript build, runs the complete test suite,
builds the production website, creates npm tarballs, and packages the VS Code
extension as a `.vsix`. It does not publish anything. Its documentation build
uses an isolated temporary output directory, so a running development docs
server does not lock the release check on Windows.

Desktop installers are excluded from this command because Windows and Linux
packages must be built on their native GitHub Actions runners.

Before publishing, confirm:

```sh
git status
npm test
```

Commit and push the exact source state that passed these checks before creating
any public release.

### Publish the npm Packages

The public npm package scope is `@truss-harness`. The npm account or
organization performing the release must own that scope. Authenticate and
confirm the active account:

```sh
npm login
npm whoami
```

Publish packages in dependency order:

```sh
npm publish --workspace @truss-harness/branding --access public
npm publish --workspace @truss-harness/runtime --access public
npm publish --workspace @truss-harness/provider-openai-compatible --access public
npm publish --workspace @truss-harness/cli --access public
npm publish --workspace @truss-harness/tui --access public
```

Users then install the clients with:

```sh
npm install -g @truss-harness/cli
npm install -g @truss-harness/tui
```

Verify the published executables:

```sh
truss-cli --help
truss-tui --help
```

Package versions cannot be published to npm more than once. For later releases,
update the package versions and their internal `@truss-harness/*` dependency
versions together before running `release:check`.

### Package and Publish the VS Code Extension

The Marketplace publisher ID must be `truss-harness`, matching the `publisher`
field in `packages/vscode/package.json`. The publisher's display name can be
`Truss`.

Create the installable extension:

```sh
npm run package:vscode
```

The command writes `truss-harness-vscode-<version>.vsix` under
`packages/vscode`. Test that exact package locally:

```sh
code --install-extension packages/vscode/truss-harness-vscode-0.1.0.vsix
```

Authenticate and publish the tested VSIX:

```sh
cd packages/vscode
npx vsce login truss-harness
npx vsce publish --packagePath truss-harness-vscode-0.1.0.vsix
cd ../..
```

Increment `packages/vscode/package.json` before each later Marketplace release.
Marketplace publication is separate from npm and desktop releases.

### Build and Deploy the Website

Build the production Next.js site:

```sh
npm run web:build
```

Run the production build locally:

```sh
npm --workspace @truss-harness/docs run start
```

Configure a Next.js-compatible host to run `npm ci` followed by
`npm run web:build`. Set `NEXT_PUBLIC_SITE_URL` to the public HTTPS origin during
the production build. Website deployment is not currently performed by the
desktop release workflow.

For Vercel, import `truss-agent/truss-harness` and use:

| Vercel setting | Value |
| --- | --- |
| Framework Preset | Next.js |
| Root Directory | `packages/docs` |
| Include source files outside Root Directory | Enabled |
| Production Branch | `master` |
| Node.js Version | 20.x |
| Output Directory | Leave at the Next.js default |
| Environment Variable | `NEXT_PUBLIC_SITE_URL=https://your-domain.example` |

`packages/docs/vercel.json` supplies the monorepo-aware install and build
commands. After the GitHub repository is connected, a push to `master`
automatically creates a production deployment. Pushes to other branches and
pull requests create preview deployments.

The `/download` page resolves installers from the latest public release at
`truss-agent/truss-harness`. It starts serving direct desktop downloads after
the first tagged desktop release succeeds.

### Ship the Desktop App

The full first-push, manual build-validation, and tagged-release procedure is in
the [Desktop Client](#desktop-client) section. In summary:

1. Push the tested source commit normally.
2. Run **Desktop release** manually from GitHub Actions and inspect its
   Windows and Linux artifacts.
3. Create an annotated tag matching `packages/desktop/package.json`, such as
   `v0.1.0`.
4. Push the tag to build and publish every desktop installer plus
   `SHA256SUMS.txt`.
5. Confirm the files appear on the website `/download` page.

### Release Order

For a coordinated release, use this order:

1. Run `npm run release:check`.
2. Commit and push the tested source.
3. Deploy the website.
4. Publish reusable npm packages, then the CLI and TUI.
5. Package, test, and publish the VS Code extension.
6. Run the manual desktop workflow.
7. Push the matching desktop version tag.
8. Verify npm installs, Marketplace installation, GitHub Release assets, and
   website downloads.

## Local Development

### Prerequisites

- Node.js 20 or newer
- npm 10 or newer
- Git, for the commit-message action
- One local model server:
  - Ollama at `http://127.0.0.1:11434`
  - LM Studio server at `http://127.0.0.1:1234/v1`
  - llama.cpp server at `http://127.0.0.1:8080/v1`
  - another OpenAI-compatible local server

Install workspace dependencies and compile every package:

```powershell
npm.cmd install
npm.cmd run build
```

Run the complete automated suite:

```powershell
npm.cmd test
npm.cmd run test:watch
```

### Documentation Site

The responsive documentation site covers local development, configuration, CLI, TUI, VS Code, tools, durable memory, and workspace commands.

```powershell
npm.cmd run docs:dev
npm.cmd run docs:build
```

Open `http://localhost:3000` after starting the development server.

`build` uses TypeScript project references and emits each package into its `dist` directory. `test` runs the runtime and provider tests. It does not need a running model server.

### Discover Local Servers and Models

Start a local server, then run:

```powershell
node packages\cli\dist\bin.js models
```

The command probes Ollama, LM Studio, and llama.cpp at their standard local addresses and prints each available endpoint with its advertised model IDs.

When no model is configured, the CLI, TUI, and VS Code panel automatically probe those same endpoints. Ollama's running-model endpoint is preferred, so an active Ollama model is selected before falling back to installed Ollama models or the first model advertised by LM Studio, llama.cpp, or another detected compatible endpoint. Explicit flags, profiles, saved VS Code settings, and environment variables always take precedence.

### CLI

The CLI needs a provider, endpoint, and model. Ollama is the default provider and uses its native `/api/chat` endpoint.

```powershell
$env:TRUSS_HARNESS_PROVIDER = "ollama"
$env:TRUSS_HARNESS_BASE_URL = "http://127.0.0.1:11434"
$env:TRUSS_HARNESS_MODEL = "qwen3:8b"
node packages\cli\dist\bin.js chat "Explain the purpose of this repository."
```

For LM Studio, llama.cpp, or another OpenAI-compatible local endpoint:

```powershell
$env:TRUSS_HARNESS_PROVIDER = "openai-compatible"
$env:TRUSS_HARNESS_BASE_URL = "http://127.0.0.1:1234/v1"
$env:TRUSS_HARNESS_MODEL = "local-model-id"
node packages\cli\dist\bin.js chat "List the important TypeScript packages here."
```

Optional environment variables:

| Variable                      | Purpose                                                |
| ----------------------------- | ------------------------------------------------------ |
| `TRUSS_HARNESS_PROVIDER`      | `ollama` or `openai-compatible`; defaults to `ollama`. |
| `TRUSS_HARNESS_BASE_URL`      | Local model server base URL.                           |
| `TRUSS_HARNESS_MODEL`         | Required model name or ID.                             |
| `TRUSS_HARNESS_API_KEY`       | Optional token for a protected local endpoint.         |
| `TRUSS_HARNESS_SYSTEM_PROMPT` | Optional system prompt.                                |

### Configuration Files and Profiles

The CLI and TUI resolve local-model settings from JSON configuration files. Use this to avoid repeating environment variables and to keep named Ollama, LM Studio, llama.cpp, or custom-server profiles.

```powershell
node packages\cli\dist\bin.js config path
node packages\cli\dist\bin.js config init
```

`config path` prints the active locations. On Windows, the user file is `%APPDATA%\truss-harness\config.json`; the workspace file is `.truss-harness\config.json`. `config init` safely creates a workspace template and refuses to overwrite an existing file.

Example `.truss-harness/config.json`:

```json
{
  "defaultProfile": "ollama-coder",
  "profiles": {
    "ollama-coder": {
      "provider": "ollama",
      "baseUrl": "http://127.0.0.1:11434",
      "model": "qwen3:8b",
      "mode": "edit",
      "permission": "ask",
      "internetAccess": false
    },
    "lm-studio-fast": {
      "provider": "openai-compatible",
      "baseUrl": "http://127.0.0.1:1234/v1",
      "model": "local-model-id",
      "mode": "plan",
      "permission": "auto-read"
    }
  }
}
```

Available profile fields are `provider`, `baseUrl`, `model`, `mode`, `permission`, `internetAccess`, `systemPrompt`, and `apiKeyEnv`. Internet research is disabled by default. Put endpoint tokens in environment variables, then reference their names with `apiKeyEnv`; do not put secrets directly in configuration files.

Settings are resolved in this order, from highest to lowest precedence:

1. CLI flags: `--profile`, `--provider`, `--base-url`, `--model`, `--mode`, `--permission`, `--internet-access`, and `--no-internet-access`
2. Selected workspace profile and workspace-level fields
3. Selected user profile and user-level fields
4. `TRUSS_HARNESS_*` environment variables
5. Local defaults: native Ollama at `http://127.0.0.1:11434`, Chat mode, and Ask permissions

For example:

```powershell
node packages\cli\dist\bin.js chat --profile ollama-coder "Explain the runtime architecture."
node packages\cli\dist\bin.js chat --profile lm-studio-fast --mode edit "Update the tests for this module."
```

The full-screen TUI resolves the same files when it starts. The VS Code panel keeps its endpoint, model, mode, and permission selections in VS Code workspace state.

### Desktop Client

The Electron desktop client provides a standalone workspace with a file tree, editor and Git diff preview, terminal pane, persistent chat history, model controls, tool approvals, and the same local-first runtime used by the other clients.

```powershell
npm.cmd run desktop:dev
```

Open a workspace, configure a local endpoint in **Settings**, and select a model. The collapsible **Git** section above Files supports status, individual stage/unstage, stage all, commit messages, pull, and push. The renderer has no Node access; filesystem, terminal, Git, and runtime operations are handled through a narrow IPC bridge in the Electron main process.

Desktop release commands:

```sh
npm run desktop:package:win:x64
npm run desktop:package:win:arm64
npm run desktop:package:linux:x64
npm run desktop:package:linux:arm64
```

The GitHub Actions desktop release workflow builds Windows NSIS, AppImage, Debian, RPM, and Arch packages for x64 and ARM64. Pushing a `v*` tag publishes them to a GitHub Release with SHA-256 checksums.

#### First Repository Push

A normal Git push uploads source code only. It does not publish a desktop
release.

Configure the repository remote before the first push:

```sh
git remote add origin https://github.com/truss-agent/truss-harness.git

git add -A
git status
git commit -m "feat: initial Truss release"
git push -u origin master
```

Review `git status` before committing to confirm that only the intended files
are staged.

#### Test Desktop Builds

After the workflow is available on GitHub:

1. Open the repository's **Actions** tab.
2. Select **Desktop release**.
3. Select **Run workflow**.

A manual workflow run:

- Runs the full automated test suite.
- Builds Windows x64 and ARM64 installers.
- Builds Linux x64 and ARM64 packages.
- Stores the packages as downloadable workflow artifacts.
- Does not create a public GitHub Release.

Run this manual validation before the first public release because Linux
packages must be built and tested on native GitHub-hosted Linux runners.

#### Publish Desktop 0.1.0

The desktop package is currently version `0.1.0`. After the manual workflow
succeeds, create and push its matching version tag:

```sh
git tag -a v0.1.0 -m "Truss Desktop 0.1.0"
git push origin v0.1.0
```

Pushing the tag automatically:

1. Runs all tests.
2. Builds every configured Windows and Linux desktop package.
3. Creates the `v0.1.0` GitHub Release.
4. Uploads the installers and `SHA256SUMS.txt`.
5. Makes the builds available through the website download page.

This workflow does not publish npm packages or the VS Code extension. Those
remain separate release processes. Unsigned desktop builds require no
repository secrets; Windows code signing can be configured later.

### VS Code Extension

1. Run `npm.cmd run build` from the repository root.
2. Open this repository in VS Code.
3. In **Run and Debug**, select **Run Truss Extension** and start it.
4. In the Extension Development Host, select the **Truss** Activity Bar icon.
5. Open **Model**, select a detected server or enter a custom endpoint, refresh the model list, choose a model, and select **Use model**.

The side panel provides chat, model configuration, tool approval controls, generation cancellation, new conversations, and commit-message generation. Inline completions are registered for editor documents; accept a returned suggestion with the normal VS Code inline-completion key binding, typically Tab.

Use the mode selector in the panel to control what the model can do:

| Mode | Tool access                                                     |
| ---- | --------------------------------------------------------------- |
| Chat | No workspace tools; optional internet tools can be enabled.     |
| Plan | Read-only workspace inspection: read, list, search, and grep.   |
| Edit | Full tool access, including file writes and terminal execution. |

The **Tool permissions** setting is enforced by the runtime service:

| Permission           | Behavior                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------- |
| Ask every time       | The panel requires Allow/Deny for every tool.                                                                 |
| Auto-allow read-only | Reads, listings, search, and grep run without prompting; writes and terminal commands still require approval. |
| Auto-allow all tools | Every tool runs without a prompt. Use only in a trusted workspace.                                            |

The conversation rail stores bounded user and assistant transcripts in VS Code workspace state and restores them when the panel or extension restarts. Live runtime session IDs remain process-local; when a restored conversation receives a new prompt, the extension seeds a fresh runtime session from its saved transcript. Changing model, mode, or permission policy starts a fresh runtime session while preserving the displayed transcript.

## Implementation Plans

Plan mode creates a short, durable implementation checklist after read-only workspace inspection. The active plan is saved locally at `.truss-harness/plans/active.json`, which is covered by the repository's `.truss-harness/` Git-ignore rule.
'hello' 
'hello' 
'hello' 
'hello' 
'hello' 
'hello' 
'hello' 
