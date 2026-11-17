# Truss

Install the CLI and full-screen terminal workspace together. Requires Node.js 22.15.1 or newer; Node 24 LTS is recommended.

```sh
npm install -g @truss-harness/truss
truss
truss tui
```

Run `truss` in your project folder to open chat. If no model is configured, guided setup helps you choose a local server or cloud provider. Both clients share profiles, credentials, workspace settings, and workspace state.

```sh
truss setup
truss models
truss chat --mode edit "Review the current diff"
truss --resume <id>
truss help
truss tui --help
```

`truss tui` requires an interactive terminal. On Windows use PowerShell or Windows Terminal; Git Bash can use the winpty bridge. CLI flags and subcommands pass through unchanged. `truss --version` reports the included CLI version.

The standalone `@truss-harness/cli` and `@truss-harness/tui` packages and their `truss-cli` and `truss-tui` commands remain supported.

Read the [CLI guide](https://truss-agent.com/docs/clients/cli), [TUI guide](https://truss-agent.com/docs/clients/tui), and [configuration reference](https://truss-agent.com/docs/configuration).
