# Truss Model Providers

<p align="center"><img src="./logo.png" width="96" alt="Truss logo"></p>

This package provides streaming adapters for native Ollama, local OpenAI-compatible servers, and a BYOK cloud catalog. The catalog includes OpenAI, Anthropic, OpenRouter, Groq, Together AI, Google Gemini, xAI, Mistral AI, DeepSeek, Perplexity, Fireworks AI, and NVIDIA NIM through documented API-key chat-completions compatibility endpoints.

Credentials implement the provider-neutral `CredentialProvider` contract from `@truss-harness/runtime` and are resolved immediately before each request. The adapter supports bearer tokens, custom headers, refreshable credentials, and request signers. Raw secrets do not belong in model configuration.

Anthropic documents its OpenAI compatibility layer primarily for evaluation and recommends its native API for production. Truss exposes the compatibility path now; a native Anthropic adapter can replace it without changing the runtime contract.

For end-user setup, use `@truss-harness/cli` or `@truss-harness/tui`.
