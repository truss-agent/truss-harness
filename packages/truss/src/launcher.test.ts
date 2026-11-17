import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, expect, it } from "vitest";

const workspace = mkdtempSync(join(tmpdir(), "truss-launcher-"));
const executable = resolve("packages/truss/dist/bin.js");
afterAll(() => rmSync(workspace, { recursive: true, force: true }));
const runWithEnvironment = (
  args: readonly string[],
  environment: NodeJS.ProcessEnv = {},
) =>
  spawnSync(process.execPath, [executable, ...args], {
    cwd: workspace,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      XDG_CONFIG_HOME: join(workspace, "user"),
      APPDATA: join(workspace, "user"),
      NO_COLOR: "1",
      TRUSS_HARNESS_PROVIDER: "openai-compatible",
      TRUSS_HARNESS_MODEL: "fixture",
      TRUSS_HARNESS_BASE_URL: "http://127.0.0.1:9/v1",
      ...environment,
    },
    timeout: 10000,
  });

const run = (...args: string[]) => runWithEnvironment(args);

it("opens CLI help for a bare noninteractive invocation", () => {
  const result = run();
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("truss <command>");
  expect(result.stdout).toContain("tui");
});
it("forwards CLI version and flags", () => {
  const result = run("--version");
  expect(result.status).toBe(0);
  expect(result.stdout).toBe("truss 0.1.38\n");
});
it("retains the invoking workspace", () => {
  const result = run("config", "path");
  expect(result.status).toBe(0);
  expect(result.stdout).toContain(join(workspace, ".truss-harness"));
});
it("dispatches tui help without requiring an interactive terminal", () => {
  const result = run("tui", "--help");
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("Truss TUI");
  expect(result.stdout).toContain("truss tui");
  expect(result.stdout).not.toContain("truss <command>");
});
it("preserves TUI noninteractive failure status", () => {
  const result = run("tui");
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("interactive terminal");
});
it("preserves CLI failure status and argument boundaries", () => {
  const result = run("unknown command");
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("unknown command");
});
it("suggests the bundled setup command when no model is configured", () => {
  const result = runWithEnvironment(
    ["chat", "hello", "--provider", "anthropic"],
    {
      TRUSS_HARNESS_MODEL: undefined,
    },
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Run truss setup");
  expect(result.stderr).not.toContain("truss-cli setup");
});
