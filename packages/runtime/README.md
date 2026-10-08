# Truss Runtime

<p align="center"><img src="./logo.png" width="96" alt="Truss logo"></p>

Provider-neutral TypeScript runtime for local-first coding-agent clients. It owns sessions, streaming model execution, tool registration, approvals, context construction, durable workspace memory, and deterministic workspace commands.

For end-user clients, install `@truss-harness/cli` or `@truss-harness/tui`.

## Runtime host 0.1.14

The standalone runtime-host bundle includes the native Anthropic Messages API
adapter from provider 0.1.15. Anthropic sessions support streaming text, tool
calls and results, attachments, and API-key or OAuth bearer credentials. The
host reports Runtime 0.1.14 in its protocol handshake; the runtime interfaces
remain compatible with existing clients.

## License and contributions

This package is source-available under the [Truss Collaborative Source
License](LICENSE). Contributions to the official project are welcome. Every
copy, fork, or derivative must preserve the license and prominently state:
**Based on Truss (https://github.com/truss-agent/truss-harness).** Commercial
use and competing products or services require separate written permission.
