# Unified Truss command

Approved by Jared: install `@truss-harness/truss` once to get `truss` and `truss tui`. Preserve standalone CLI/TUI packages and legacy commands.

## Approach
A small launcher package depends on the existing clients. It imports their published executable entry points in the same process, removing only the `tui` subcommand before launching the TUI. This preserves terminal ownership, signals, exit codes, working directory, configuration, and arguments. CLI help advertises the bundled TUI command when invoked through the launcher.

Separate installations were rejected in favor of one installation. A CLI-to-TUI dependency would create a cycle because the TUI already consumes CLI services. The umbrella package avoids that cycle. No runtime or editor protocol changes.

Update current installation and usage documentation throughout the repository and docs site. Retain historical changelog entries and executable configuration names where legacy compatibility matters. Patch-version the CLI and TUI, publish the new launcher, and tag only merged master after required checks. Verify a clean packed installation and the live npm release, then install it locally.
