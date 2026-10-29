import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { it, expect } from "vitest";
import { GitService } from "./git-service.js";
const exec = promisify(execFile);
async function repository(
  test: (
    root: string,
    git: (...args: string[]) => Promise<string>,
    service: GitService,
  ) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "truss-git-"));
  const git = async (...args: string[]) =>
    (await exec("git", args, { cwd: root })).stdout;
  try {
    await git("init", "-q");
    await git("config", "user.name", "Fixture");
    await git("config", "user.email", "fixture@example.invalid");
    const service = new GitService(
      () => root,
      (path) => join(root, path),
      (c, a, o) => exec(c, [...a], o),
      () => undefined,
      async () => "",
    );
    await test(root, git, service);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
it("commits only the existing index including a partially staged file", async () =>
  repository(async (root, git, service) => {
    await writeFile(join(root, "a"), "base\n");
    await writeFile(join(root, "b"), "base\n");
    await git("add", ".");
    await git("commit", "-qm", "base");
    await writeFile(join(root, "a"), "staged\n");
    await git("add", "a");
    await writeFile(join(root, "a"), "unstaged\n");
    await writeFile(join(root, "b"), "other\n");
    await writeFile(join(root, "c"), "new\n");
    await service.commit("selected");
    expect(await git("show", "HEAD:a")).toBe("staged\n");
    expect(await git("show", "HEAD:b")).toBe("base\n");
    expect(await git("status", "--porcelain")).toContain("?? c");
  }));
it("does not implicitly stage when the index is empty", async () =>
  repository(async (root, git, service) => {
    await writeFile(join(root, "a"), "base");
    await git("add", ".");
    await git("commit", "-qm", "base");
    await writeFile(join(root, "a"), "changed");
    await expect(service.commit("accidental")).rejects.toThrow();
    expect(await git("show", "HEAD:a")).toBe("base");
  }));
it("round-trips exact porcelain paths and rename origins through Git actions", async () =>
  repository(async (root, git, service) => {
    const names = [
      "space name",
      'quote"name',
      "back\\slash",
      "tab\tname",
      "line\nname",
      "日本語",
      " trailing ",
    ];
    for (const name of names) await writeFile(join(root, name), "base");
    await git("add", ".");
    await git("commit", "-qm", "base");
    for (const name of names) await writeFile(join(root, name), "changed");
    expect((await service.status()).files.map((f) => f.path).sort()).toEqual(
      [...names].sort(),
    );
    for (const name of names) {
      await service.stage([name]);
      expect(await service.diffFile(name)).toContain("+changed");
      await service.unstage([name]);
    }
    await service.discard(names);
    expect((await service.status()).files).toEqual([]);
    await git("mv", "space name", "renamed\nfile");
    expect((await service.status()).files).toContainEqual({
      path: "renamed\nfile",
      originalPath: "space name",
      indexStatus: "R",
      workTreeStatus: " ",
    });
    await service.unstage(["renamed\nfile"]);
    expect(await git("diff", "--cached", "--name-only")).toBe("");
    await git("add", "-A");
    await service.discard(["renamed\nfile"]);
    expect((await service.status()).files).toEqual([]);
  }));
