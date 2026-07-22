# Truss CLI

<p align="center"><img src="./logo.png" width="96" alt="Truss logo"></p>

Truss is a local-first coding-agent runtime. The CLI runs one-shot agent tasks and hosts the runtime service used by editor clients.

## Requirements

- Node.js 20 or newer
- Ollama, LM Studio, llama.cpp, another compatible local server, or a supported cloud-provider API key
- A model with native tool calling for Agent and Plan workflows

## Install

```sh
npm install -g @truss-harness/cli
```

The global installer prints a short first-run checklist. You can display the complete reference at any time:

```sh
truss-cli
truss-cli help
```

## Interactive setup

Run truss-cli setup after installation to discover a local server or configure a cloud BYOK profile, then save it as the default user-level profile. Cloud setup stores only the provider, model, and environment-variable name; it never writes the key itself. It is a command rather than an install-time prompt, so npm installs remain safe in CI and scripts.

## First run

Start your local model server, open a terminal in the project you want Truss to work on, and run:

```sh
truss-cli models
truss-cli chat --mode edit "Explain this workspace"
```

Truss probes the standard Ollama, LM Studio, and llama.cpp endpoints when no model is configured. Create a reusable workspace profile when you want explicit settings:

```sh
truss-cli config init
truss-cli config path
```

## Agent tasks

```sh
truss-cli chat --mode chat "Explain the architecture"
truss-cli chat --mode plan "Plan an authentication refactor"
truss-cli chat --mode edit "Fix the failing tests"
truss-cli chat --internet-access "Check the current library documentation"
```

Direct CLI chat is non-interactive and auto-allows registered tools. Run it only in a trusted workspace. Public internet tools are disabled unless `--internet-access`, a profile, or the environment explicitly enables them.

## Persistent chat

Run `truss-cli chat` without a prompt to keep one local conversation open. The configuration flags supplied when it starts remain active, and history remains available as you send messages.

```sh
truss-cli chat --mode edit --permission auto-read
```

Use `:mode chat`, `:mode plan`, or `:mode edit` to change the active mode. You can also prefix a message with `--mode edit`, for example `--mode edit Inspect the repository and explain it.` The mode change persists for the rest of that conversation. Use `:clear` for a fresh conversation, `:help` for controls, and `:exit` to close it.

## Workspace commands

These deterministic commands work without a configured model:

```text
truss-cli init                 Create or refresh generated AGENTS.md context
truss-cli update [note]        Record Git state and a durable handoff note
truss-cli status               Show Git state and recent durable records
truss-cli clear-memory         Remove durable workspace memory
truss-cli commands             Show slash commands used by interactive clients
```

## Configuration

`truss-cli config init` creates `.truss-harness/config.json`. Profiles support `provider`, `baseUrl`, `model`, `mode`, `permission`, `internetAccess`, `systemPrompt`, `apiKeyEnv`, and `mcpServers`.

```json
{
  "defaultProfile": "ollama",
  "profiles": {
    "ollama": {
      "provider": "ollama",
      "baseUrl": "http://127.0.0.1:11434",
      "model": "qwen3:8b",
      "mode": "edit",
      "permission": "ask",
      "internetAccess": false
    }
  }
}
```

Keep endpoint tokens out of JSON. Set the token in an environment variable and place that variable's name in `apiKeyEnv`.

## Bring your own key

The API-key cloud-provider rollout supports `openai`, `anthropic`, `openrouter`, `groq`, `together`, `gemini`, `xai`, `mistral`, `deepseek`, `perplexity`, `fireworks`, and `nvidia-nim`. Truss supplies each provider's documented endpoint and reads its conventional environment variable, so a profile only needs a provider and model:

```json
{
  "defaultProfile": "groq",
  "profiles": {
    "groq": {
      "provider": "groq",
      "model": "your-tool-capable-model",
      "mode": "edit",
      "permission": "ask"
    }
  }
}
```

Set the matching credential outside the configuration file: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `TOGETHER_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY`, `MISTRAL_API_KEY`, `DEEPSEEK_API_KEY`, `PERPLEXITY_API_KEY`, `FIREWORKS_API_KEY`, or `NVIDIA_API_KEY`. `TRUSS_HARNESS_API_KEY` remains available for custom OpenAI-compatible endpoints, and `apiKeyEnv` can name a different environment variable in a profile.

Anthropic's current compatibility endpoint is intended primarily for evaluation; use it as an initial BYOK path while a native adapter is developed. OAuth/account sign-in, AWS IAM signing, Azure Entra, and client keychain UI are not part of this first rollout.

MCP stdio servers can be defined under `mcpServers`. User-level definitions load normally. Workspace definitions can launch local processes and are ignored unless the user configuration sets `"allowWorkspaceMcpServers": true`. Plan mode loads only servers marked `"readOnly": true`; Agent mode loads all enabled servers. MCP calls follow the selected approval policy.

## Service mode

`truss-cli serve` starts the newline-delimited JSON runtime protocol used by clients such as the VS Code extension. Standard output is reserved for protocol messages.

Run `truss-cli help` for every command, flag, environment variable, mode, permission policy, and example.
