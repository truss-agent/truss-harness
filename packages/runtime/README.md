# Truss Runtime

<p align="center"><img src="./logo.png" width="96" alt="Truss logo"></p>

Provider-neutral TypeScript runtime for local-first coding-agent clients. It owns sessions, streaming model execution, tool registration, approvals, context construction, durable workspace memory, and deterministic workspace commands.

For end-user clients, install `@truss-harness/cli` or `@truss-harness/tui`.

## Runtime 0.1.15

Runtime 0.1.15 adds skills: source-qualified skill IDs, discovery of bundled
Superpowers, personal and workspace skills, a managed skill store, and
per-run Automatic, Manual, or Off modes. It also tightens cancellation,
workspace path containment, and approval enforcement. Existing runtime
interfaces remain compatible.

## License and contributions

This package is source-available under the [Truss Collaborative Source
License](LICENSE). Contributions to the official project are welcome. Every
copy, fork, or derivative must preserve the license and prominently state:
**Based on Truss (https://github.com/truss-agent/truss-harness).** Commercial
use and competing products or services require separate written permission.
