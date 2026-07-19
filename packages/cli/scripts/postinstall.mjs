if (process.env.npm_config_global === "true" || process.env.npm_config_global === "1") {
  process.stdout.write(`
Truss CLI installed.

Next steps:
  truss-cli setup
  truss-cli chat --mode edit

Run truss-cli help for modes, permissions, configuration, and examples.
`);
}
