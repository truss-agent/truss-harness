# Truss Model Providers

<p align="center"><img src="./logo.png" width="96" alt="Truss logo"></p>

This package provides streaming adapters for native Ollama, Anthropic Messages, local OpenAI-compatible servers, and a BYOK cloud catalog. The catalog includes OpenAI, OpenRouter, Groq, Together AI, Google Gemini, xAI, Mistral AI, DeepSeek, Perplexity, Fireworks AI, NVIDIA NIM, Xiaomi MiMo, and Sakana Fugu through documented API-key chat-completions compatibility endpoints, plus Anthropic and Ollama Cloud through their native hosted APIs. Local Ollama remains key-free.

Credentials implement the provider-neutral `CredentialProvider` contract from `@truss-harness/runtime` and are resolved immediately before each request. The adapter supports bearer tokens, custom headers, refreshable credentials, and request signers. Raw secrets do not belong in model configuration.

Anthropic uses its native Messages API adapter, including streaming text, tool calls, tool results, attachments, and API-key or OAuth bearer authentication, without changing the runtime contract.

For end-user setup, use `@truss-harness/cli` or `@truss-harness/tui`.

## License and contributions

This package is source-available under the [Truss Collaborative Source
License](LICENSE). Contributions to the official project are welcome. Every
copy, fork, or derivative must preserve the license and prominently state:
**Based on Truss (https://github.com/truss-agent/truss-harness).** Commercial
use and competing products or services require separate written permission.
