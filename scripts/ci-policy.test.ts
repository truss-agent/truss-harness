import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Execute the real affected-client step, replacing only external commands.
function selectedClients(path: string): string {
  const workflow = readFileSync(".github/workflows/pull-request.yml", "utf8");
  const body = workflow
    .split("          changed_files=")[1]
    ?.split('\n          if affects "^packages/neovim/')[0];
  if (!body) throw new Error("Affected-client workflow step not found");
  const script = `git() { printf '%s\\n' "$CHANGED_PATH"; }; npm() { printf '%s\\n' "$*"; };\nchanged_files=${body}`;
  return execFileSync("bash", ["-e", "-c", script], {
    env: {
      ...process.env,
      CHANGED_PATH: path,
      BASE_SHA: "base",
      HEAD_SHA: "head",
    },
    encoding: "utf8",
  });
}

describe("affected client verification", () => {
  it.each([
    "packages/agent-host/src/index.ts",
    "packages/cli/src/protocol.ts",
    "packages/gateway/src/index.ts",
    "packages/runtime/src/index.ts",
  ])("typechecks mobile for %s", (path) => {
    expect(selectedClients(path)).toContain(
      "@truss-harness/mobile run typecheck",
    );
  });
  it("leaves unrelated documentation scoped", () => {
    expect(selectedClients("README.md")).not.toContain("mobile");
  });
});

it("rejects an unmerged release source and accepts a merged commit", () => {
  const dir = mkdtempSync(join(tmpdir(), "truss-release-policy-"));
  const script = resolve("scripts/verify-release-source.mts");
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  try {
    git("init", "-b", "master");
    git("config", "user.name", "Release policy fixture");
    git("config", "user.email", "fixture@example.invalid");
    writeFileSync(join(dir, "fixture"), "merged");
    git("add", ".");
    git("commit", "-m", "merged source");
    git("update-ref", "refs/remotes/origin/master", "HEAD");
    const run = () =>
      spawnSync(process.execPath, [script], { cwd: dir, encoding: "utf8" });
    expect(run().status).toBe(0);
    git("checkout", "-b", "unmerged");
    writeFileSync(join(dir, "fixture"), "unmerged");
    git("commit", "-am", "feature source");
    expect(run().status).not.toBe(0);
    git("update-ref", "refs/remotes/origin/master", "HEAD");
    expect(run().status).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("checks merged source before every release and keeps Android credentials behind verification", () => {
  for (const name of [
    "desktop",
    "runtime-host",
    "vscode",
    "truss-go-android",
    "neovim",
  ]) {
    const workflow = readFileSync(
      `.github/workflows/${name}-release.yml`,
      "utf8",
    );
    expect(workflow).toContain("node scripts/verify-release-source.mts");
    expect(
      workflow.indexOf("node scripts/verify-release-source.mts"),
    ).toBeLessThan(workflow.indexOf("npm ci"));
    expect(workflow).toContain("fetch-depth: 0");
  }
  const android = readFileSync(
    ".github/workflows/truss-go-android-release.yml",
    "utf8",
  );
  const [verify, release] = android.split("\n  release:\n");
  expect(verify).toContain("contents: read");
  expect(verify).toContain("@truss-harness/mobile run typecheck");
  expect(verify).toContain("npm test");
  expect(verify).not.toContain("EXPO_TOKEN");
  expect(release).toContain("needs: verify");
  expect(release).toContain("contents: write");
  expect(release).toContain("EXPO_TOKEN");
});
