if (process.env.npm_config_global === "true" || process.env.npm_config_global === "1") {
  process.stdout.write(`
Truss CLI installed.

Next steps:
  truss-cli models
  truss-cli config init
  truss-cli chat "Explain this workspace"

Run truss-cli help for modes, permissions, configuration, and examples.
`);
}
