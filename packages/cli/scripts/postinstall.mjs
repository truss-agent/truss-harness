if (
  process.env.npm_config_global === "true" ||
  process.env.npm_config_global === "1"
) {
  process.stdout.write(`
Truss CLI installed.

Next steps:
  truss setup
  truss chat --mode edit

Use the bundled command with npm install -g @truss-harness/truss.
Standalone CLI installs can use truss-cli instead.
Run truss help for modes, permissions, configuration, and examples.
`);
}
