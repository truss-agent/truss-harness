#!/usr/bin/env node
// Keep both clients in this process so stdin, raw mode, signals and exit codes
// behave exactly as they do for their standalone commands.
process.argv[1] = "truss";
if (process.argv[2] === "tui") {
  process.argv.splice(2, 1);
  await import("@truss-harness/tui/bin");
} else {
  await import("@truss-harness/cli/bin");
}
export {};
