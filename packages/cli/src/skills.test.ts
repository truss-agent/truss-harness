import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDefaultSkills } from "@truss-harness/agent-host";
import { afterEach, describe, expect, it } from "vitest";
import { runSkillsCommand } from "./skills.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("skills command", () => {
  it("lists, imports, selects, switches modes and removes", async () => {
    const base = await mkdtemp(join(tmpdir(), "truss-skills-command-"));
    roots.push(base);
    const workspace = join(base, "workspace");
    await mkdir(join(workspace, "my-skill"), { recursive: true });
    await writeFile(
      join(workspace, "my-skill", "SKILL.md"),
      "---\nname: my-skill\ndescription: Mine\n---\nBody\n",
    );
    const skills = createDefaultSkills({
      workspaceRoot: workspace,
      userConfigDirectory: join(base, "config"),
    });
    let output = "";
    const run = async (...args: string[]) => {
      output = "";
      return runSkillsCommand(args, skills, workspace, (text) => {
        output += text;
      });
    };

    expect(await run()).toBe(0);
    expect(output).toContain(
      "Mode: automatic  Superpowers: on  Selected: none",
    );
    expect(output).toContain("superpowers:brainstorming");
    expect(await run("add", "my-skill")).toBe(0);
    expect(output).toBe("Imported user:my-skill\n");
    expect(await run("select", "user:my-skill")).toBe(0);
    expect(await run("mode", "manual", "--workspace")).toBe(0);
    expect(await run("superpowers", "off")).toBe(0);
    expect(output).toBe(
      "Mode: manual  Superpowers: off  Selected: user:my-skill\n",
    );
    expect(await run("list", "--json")).toBe(0);
    expect(JSON.parse(output).selection).toEqual({
      mode: "manual",
      superpowersEnabled: false,
      skillIds: ["user:my-skill"],
    });
    expect(await run("remove", "user:my-skill")).toBe(0);
    await expect(run("mode", "loud")).rejects.toThrow(/skill mode/);
    expect(await run("superpowers", "maybe")).toBe(2);
    expect(output).toContain("Usage:");
  });
});
