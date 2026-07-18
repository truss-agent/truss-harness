# Truss CLI

<p align="center"><img src="./logo.png" width="96" alt="Truss logo"></p>

The Truss CLI runs a local-first coding agent from a shell and hosts the newline-delimited JSON service used by editor clients.

## Install

```sh
npm install -g @truss-harness/cli
```

Start Ollama, LM Studio, llama.cpp server, or another local OpenAI-compatible server, then either create a workspace profile or pass the model settings directly.

```sh
truss-harness config init
truss-harness models
truss-harness chat --profile ollama "Explain this repository"
```

## Workspace commands

These commands do not call a model and work even when no provider is configured:

```text
truss-harness init                 Scan the repository and create or refresh AGENTS.md context.
truss-harness update [note]        Record Git state and a progress note in .truss-harness/agent-state.json.
truss-harness status               Show current Git state and recent durable records.
truss-harness clear-memory         Remove durable workspace memory.
truss-harness commands             Show the slash-command help text.
```

The same actions can be sent to chat as `/init`, `/update`, `/status`, `/clear-memory`, and `/help`.

## Local model profiles

`truss-harness config init` creates `.truss-harness/config.json`. Profiles support `provider`, `baseUrl`, `model`, `mode`, `permission`, `systemPrompt`, and `apiKeyEnv`.

```json
{
  "defaultProfile": "ollama",
  "profiles": {
    "ollama": {
      "provider": "ollama",
      "baseUrl": "http://127.0.0.1:11434",
      "model": "qwen3:8b",
      "mode": "edit",
      "permission": "ask"
    }
  }
}
```

Use `truss-harness help` for command options. `truss-harness serve` reserves standard output for its JSON protocol; do not add terminal logging to that stream.
