import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDefaultSkills } from "@truss-harness/agent-host";
import { afterEach, describe, expect, it } from "vitest";
import { DesktopSkillService } from "./skill-service.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function setup() {
  const base = await mkdtemp(join(tmpdir(), "truss-desktop-skills-"));
  roots.push(base);
  const workspace = join(base, "workspace");
  const source = join(base, "picked", "notes");
  await mkdir(workspace, { recursive: true });
  await mkdir(source, { recursive: true });
  await writeFile(
    join(source, "SKILL.md"),
    "---\nname: notes\ndescription: Release notes\n---\nBody\n",
  );
  let picked: string | undefined = source;
  let resolutions = 0;
  const service = new DesktopSkillService({
    workspaceRoot: () => workspace,
    chooseDirectory: async () => picked,
    resolve: async (workspaceRoot) => {
      resolutions += 1;
      return createDefaultSkills({
        workspaceRoot,
        userConfigDirectory: join(base, "config"),
      });
    },
  });
  return {
    service,
    cancelPicker: () => {
      picked = undefined;
    },
    resolutions: () => resolutions,
  };
}

describe("DesktopSkillService", () => {
  it("imports a picked folder, saves choices, and forgets removed skills", async () => {
    const test = await setup();
    const listed = await test.service.list();
    expect(listed.selection).toEqual({
      mode: "automatic",
      superpowersEnabled: true,
      skillIds: [],
    });
    expect(listed.skills.some((skill) => skill.source === "bundled")).toBe(
      true,
    );

    const imported = await test.service.importDirectory();
    expect(imported?.skills).toContainEqual(
      expect.objectContaining({ id: "user:notes", trusted: true }),
    );
    test.cancelPicker();
    expect(await test.service.importDirectory()).toBeUndefined();

    await test.service.setSettings("user", { skillIds: ["user:notes"] });
    expect(
      (await test.service.setSettings("workspace", { mode: "manual" }))
        .selection,
    ).toEqual({
      mode: "manual",
      superpowersEnabled: true,
      skillIds: ["user:notes"],
    });
    expect(
      (await test.service.setSettings("workspace", null)).selection.mode,
    ).toBe("automatic");

    const removed = await test.service.remove("user:notes");
    expect(removed.skills.map((skill) => skill.id)).not.toContain("user:notes");
    expect(removed.selection.skillIds).toEqual([]);
    // One resolution per workspace serves every call and runtime.
    expect(test.resolutions()).toBe(1);
  });
});
