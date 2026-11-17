# truss.nvim compatibility

truss.nvim and `truss-cli` negotiate a versioned local-service protocol. The
plugin checks the server's protocol before sending a run, and optional
capabilities are checked before their commands use them.

| truss.nvim | Minimum truss-cli | Neovim | Protocol | Support |
| --- | --- | --- | --- | --- |
| 0.3.1 | 0.1.14 | 0.10+ | v1 | Open straight into the composer with dotenv context excluded |
| 0.3.0 | 0.1.14 | 0.10+ | v1 | Multiline composer, resumable mode sessions, and pending approval review |
| 0.2.4 | 0.1.14 | 0.10+ | v1 | Standalone distribution with shared skill controls |
| 0.2.3 | 0.1.14 | 0.10+ | v1 | Standalone distribution with a runtime-host handshake |
| 0.2.1 | 0.1.14 | 0.10+ | v1 | Previous standalone distribution with health checks, Chat, Plan, Edit, approvals, profiles, provider tests, and MCP status |
| 0.2.0 | 0.1.13 | 0.10+ | v1 | Monorepo preview with native agent workflows |
| 0.1.0 | 0.1.12 | 0.10+ | v1 | Initial chat preview |

Run `:checkhealth truss` after installing or updating. It verifies Neovim,
the configured CLI command and version, the workspace, and optional Git
support without starting the service or contacting a model provider. Then run
`:TrussTestConnection` when you intentionally want to verify the configured
provider, model, and credential.

New optional host features degrade behind negotiated capability flags. A
protocol-version mismatch fails before a run starts and requires updating the
older side.
