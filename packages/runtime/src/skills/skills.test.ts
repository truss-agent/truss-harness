import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CompositeSkillRegistry,
  defaultSkillPolicy,
  FileSkillSettingsStore,
  FileSkillSource,
  FileSkillStore,
  parseSkillDocument,
  resolveSkillSelection,
  validateSkillSelection,
} from "./index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function temporary(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "truss-skills-"));
  roots.push(root);
  return root;
}
function skillText(name: string, description = `Use for ${name}`, body = "") {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n${body}`;
}
async function writeSkill(
  root: string,
  name: string,
  text = skillText(name),
  files: Record<string, string> = {},
) {
  await mkdir(join(root, name), { recursive: true });
  await writeFile(join(root, name, "SKILL.md"), text);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, name, path, ".."), { recursive: true });
    await writeFile(join(root, name, path), content);
  }
}

describe("parseSkillDocument", () => {
  it("reads plain and quoted frontmatter and keeps the body", () => {
    expect(
      parseSkillDocument(
        '---\nname: brainstorming\ndescription: "Use before \\"creative\\" work"\nversion: 2\n---\n\nBody text\n',
      ),
    ).toEqual({
      name: "brainstorming",
      description: 'Use before "creative" work',
      body: "\nBody text\n",
    });
    expect(
      parseSkillDocument(
        "---\r\nname: tdd\r\ndescription: 'It''s tested'\r\n---\r\nBody",
      ),
    ).toEqual({ name: "tdd", description: "It's tested", body: "Body" });
  });

  it("rejects missing frontmatter, fields and unsafe names", () => {
    expect(() => parseSkillDocument("# Just markdown")).toThrow(/frontmatter/);
    expect(() => parseSkillDocument("---\nname: a\n---\nbody")).toThrow(
      /description/,
    );
    expect(() =>
      parseSkillDocument("---\nname: ../evil\ndescription: x\n---\n"),
    ).toThrow(/name/);
    expect(() =>
      parseSkillDocument("---\nname: Upper\ndescription: x\n---\n"),
    ).toThrow(/name/);
    expect(() =>
      parseSkillDocument("---\nname: open\ndescription: x\n"),
    ).toThrow(/frontmatter/);
  });
});

describe("FileSkillSource", () => {
  it("discovers valid skills with qualified IDs, resources and diagnostics", async () => {
    const base = await temporary();
    const root = join(base, "skills");
    await writeSkill(root, "beta", undefined, {
      "reference.md": "ref",
      "scripts/run.sh": "echo hi",
      ".env": "SECRET=1",
      ".git/config": "x",
    });
    await writeSkill(root, "alpha");
    await writeSkill(root, "broken", "no frontmatter");
    await writeSkill(root, "mismatch", skillText("other"));
    await mkdir(join(root, ".hidden"));
    await writeFile(join(root, "loose.md"), "not a skill");

    const source = new FileSkillSource({
      root,
      source: "user",
      prefix: "user",
      trusted: true,
    });
    const listing = await source.list();
    expect(listing.skills.map((skill) => skill.id)).toEqual([
      "user:alpha",
      "user:beta",
    ]);
    const beta = listing.skills[1];
    expect(beta).toMatchObject({
      name: "beta",
      description: "Use for beta",
      source: "user",
      trusted: true,
      resources: ["reference.md", "scripts/run.sh"],
    });
    expect(beta.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(listing.diagnostics.map((item) => item.skillId).sort()).toEqual([
      "user:broken",
      "user:mismatch",
    ]);
    expect(JSON.stringify(listing)).not.toContain(base);
  });

  it("enforces the SKILL.md size boundary", async () => {
    const root = await temporary();
    const header = skillText("exact");
    await writeSkill(
      root,
      "exact",
      header + "x".repeat(defaultSkillPolicy.maxSkillBytes - header.length),
    );
    await writeSkill(
      root,
      "oversized",
      skillText("oversized") + "x".repeat(defaultSkillPolicy.maxSkillBytes),
    );
    const listing = await new FileSkillSource({
      root,
      source: "user",
      prefix: "user",
      trusted: true,
    }).list();
    expect(listing.skills.map((skill) => skill.id)).toEqual(["user:exact"]);
    expect(listing.diagnostics).toEqual([
      expect.objectContaining({
        skillId: "user:oversized",
        message: expect.stringMatching(/32768/),
      }),
    ]);
  });

  it("does not follow symlinks out of the skill root", async () => {
    const base = await temporary();
    const root = join(base, "skills");
    const outside = join(base, "outside");
    await writeSkill(outside, "escaped");
    await writeFile(join(outside, "canary.txt"), "outside secret");
    await writeSkill(root, "inside");
    await symlink(join(outside, "escaped"), join(root, "escaped"));
    await symlink(join(base, "missing"), join(root, "dangling"));
    await symlink(join(outside, "canary.txt"), join(root, "inside", "leak.md"));
    const source = new FileSkillSource({
      root,
      source: "workspace",
      prefix: "workspace",
      trusted: false,
    });
    const listing = await source.list();
    expect(listing.skills.map((skill) => skill.id)).toEqual([
      "workspace:inside",
    ]);
    expect(listing.skills[0]?.resources).toEqual([]);
    expect(listing.diagnostics.map((item) => item.skillId).sort()).toEqual([
      "workspace:dangling",
      "workspace:escaped",
    ]);
    await expect(source.readResource("inside", "leak.md")).rejects.toThrow();
  });

  it("reads resources in bounded chunks with continuation", async () => {
    const root = await temporary();
    const large = "é".repeat(10_000); // 20000 UTF-8 bytes
    await writeSkill(root, "docs", undefined, { "big.md": large });
    const source = new FileSkillSource({
      root,
      source: "user",
      prefix: "user",
      trusted: true,
    });
    const first = await source.readResource("docs", "big.md");
    expect(first.totalBytes).toBe(20_000);
    expect(Buffer.byteLength(first.content)).toBeLessThanOrEqual(16_384);
    expect(first.nextOffset).toBe(Buffer.byteLength(first.content));
    const second = await source.readResource("docs", "big.md", {
      offset: first.nextOffset,
      limit: 100_000,
    });
    expect(second.nextOffset).toBeUndefined();
    expect(first.content + second.content).toBe(large);
    const tiny = await source.readResource("docs", "big.md", {
      offset: 1,
      limit: 5,
    });
    // Starts mid code point and would end mid code point: both edges move to
    // whole characters, never emitting U+FFFD.
    expect(tiny.content).toBe("éé");
    expect(tiny.offset).toBe(2);
    expect(tiny.nextOffset).toBe(6);
    await expect(
      source.readResource("docs", "big.md", { limit: 3 }),
    ).rejects.toThrow(/at least 4/);
  });

  it("rejects traversal, absolute, hidden and unlisted resource paths", async () => {
    const root = await temporary();
    await writeSkill(root, "docs", undefined, {
      "a.md": "a",
      ".env": "SECRET=1",
    });
    await writeSkill(root, "other", undefined, { "b.md": "b" });
    const source = new FileSkillSource({
      root,
      source: "user",
      prefix: "user",
      trusted: true,
    });
    for (const path of [
      "../other/b.md",
      "/etc/passwd",
      ".env",
      "a.md/../../other/b.md",
      "SKILL.md/x",
      "",
      "missing.md",
    ])
      await expect(source.readResource("docs", path)).rejects.toThrow();
    await expect(source.readResource("../docs", "a.md")).rejects.toThrow();
    expect((await source.readResource("docs", "a.md")).content).toBe("a");
  });
});

describe("CompositeSkillRegistry", () => {
  it("keeps same-named skills from different sources distinct", async () => {
    const base = await temporary();
    await writeSkill(join(base, "user"), "notes", skillText("notes", "Mine"));
    await writeSkill(
      join(base, "workspace"),
      "notes",
      skillText("notes", "Repo", "Repo body"),
    );
    const registry = new CompositeSkillRegistry([
      new FileSkillSource({
        root: join(base, "user"),
        source: "user",
        prefix: "user",
        trusted: true,
      }),
      new FileSkillSource({
        root: join(base, "workspace"),
        source: "workspace",
        prefix: "workspace",
        trusted: false,
      }),
      new FileSkillSource({
        root: join(base, "absent"),
        source: "bundled",
        prefix: "superpowers",
        bundle: "superpowers",
        trusted: true,
      }),
    ]);
    const listing = await registry.list();
    expect(
      listing.skills.map((skill) => [
        skill.id,
        skill.description,
        skill.trusted,
      ]),
    ).toEqual([
      ["user:notes", "Mine", true],
      ["workspace:notes", "Repo", false],
    ]);
    expect(listing.diagnostics).toEqual([]);
    expect((await registry.get("workspace:notes"))?.instructions).toContain(
      "Repo body",
    );
    expect(await registry.get("superpowers:notes")).toBeUndefined();
    expect(await registry.get("notes")).toBeUndefined();
    await expect(registry.readResource("nope:notes", "a.md")).rejects.toThrow(
      /Unknown skill/,
    );
  });
});

describe("FileSkillStore", () => {
  async function store() {
    const base = await temporary();
    const managed = join(base, "managed");
    return {
      base,
      managed,
      store: new FileSkillStore({ root: managed }),
      source: new FileSkillSource({
        root: managed,
        source: "user",
        prefix: "user",
        trusted: true,
      }),
    };
  }

  it("imports a directory, copying only regular visible text files", async () => {
    const { base, store: skills, source } = await store();
    await writeSkill(join(base, "src"), "review", undefined, {
      "checklist.md": "check",
      ".env": "SECRET=1",
      "node_modules/x/index.js": "x",
    });
    const metadata = await skills.import({
      kind: "directory",
      path: join(base, "src", "review"),
    });
    expect(metadata).toMatchObject({
      id: "user:review",
      trusted: true,
      resources: ["checklist.md"],
    });
    expect((await source.list()).skills.map((skill) => skill.id)).toEqual([
      "user:review",
    ]);
    await expect(
      skills.import({ kind: "directory", path: join(base, "src", "review") }),
    ).rejects.toThrow(/already exists/);
    await expect(
      skills.import({
        kind: "directory",
        path: join(base, "src", "review"),
        replace: true,
      }),
    ).resolves.toMatchObject({ id: "user:review" });
  });

  it("rejects symlinks and oversized content without leaving partial skills", async () => {
    const { base, managed, store: skills } = await store();
    await writeSkill(join(base, "src"), "linked");
    await writeFile(join(base, "secret.txt"), "secret");
    await symlink(
      join(base, "secret.txt"),
      join(base, "src", "linked", "s.md"),
    );
    await expect(
      skills.import({ kind: "directory", path: join(base, "src", "linked") }),
    ).rejects.toThrow(/symlink/i);
    await expect(
      skills.import({
        kind: "content",
        content: skillText("huge"),
        resources: [
          {
            path: "big.md",
            content: "x".repeat(defaultSkillPolicy.maxResourceBytes + 1),
          },
        ],
      }),
    ).rejects.toThrow(/exceeds/);
    await expect(
      skills.import({
        kind: "content",
        content: skillText("escape"),
        resources: [{ path: "../escape.md", content: "x" }],
      }),
    ).rejects.toThrow(/path/i);
    expect(await readdir(managed).catch(() => [])).toEqual([]);
  });

  it("imports pasted content and removes only user skills", async () => {
    const { store: skills, source } = await store();
    await skills.import({
      kind: "content",
      content: skillText("pasted"),
      resources: [{ path: "notes/a.md", content: "A" }],
    });
    expect((await source.readResource("pasted", "notes/a.md")).content).toBe(
      "A",
    );
    await expect(skills.remove("superpowers:brainstorming")).rejects.toThrow(
      /Only user/,
    );
    await expect(skills.remove("workspace:pasted")).rejects.toThrow(
      /Only user/,
    );
    await expect(skills.remove("user:../x")).rejects.toThrow();
    await skills.remove("user:pasted");
    expect((await source.list()).skills).toEqual([]);
    await expect(skills.remove("user:pasted")).rejects.toThrow(/not found/);
  });

  it("serializes concurrent imports", async () => {
    const { store: skills, source } = await store();
    await Promise.all(
      ["one", "two", "three"].map((name) =>
        skills.import({ kind: "content", content: skillText(name) }),
      ),
    );
    expect((await source.list()).skills.map((skill) => skill.name)).toEqual([
      "one",
      "three",
      "two",
    ]);
  });
});

describe("skill selection", () => {
  it("layers partial selections with later layers winning", () => {
    expect(resolveSkillSelection([])).toEqual({
      mode: "automatic",
      superpowersEnabled: true,
      skillIds: [],
    });
    expect(
      resolveSkillSelection([
        { mode: "manual", skillIds: ["user:a"] },
        undefined,
        { superpowersEnabled: false },
        { skillIds: ["user:b"] },
      ]),
    ).toEqual({
      mode: "manual",
      superpowersEnabled: false,
      skillIds: ["user:b"],
    });
  });

  it("explains invalid or over-budget selections", () => {
    const skill = (id: string, bytes = 100, trusted = true) => ({
      id,
      name: id.split(":")[1] ?? "",
      description: "d",
      source: (id.startsWith("superpowers:")
        ? "bundled"
        : id.startsWith("workspace:")
          ? "workspace"
          : "user") as "user",
      ...(id.startsWith("superpowers:") ? { bundle: "superpowers" } : {}),
      trusted,
      resources: [],
      instructionBytes: bytes,
      sha256: "0".repeat(64),
    });
    const available = [
      skill("user:a"),
      skill("user:big", 40_000),
      skill("user:big2", 40_000),
      skill("workspace:repo", 100, false),
      skill("superpowers:tdd"),
      ...Array.from({ length: 9 }, (_, index) => skill(`user:s${index}`)),
    ];
    const base = { mode: "manual", superpowersEnabled: true } as const;
    expect(
      validateSkillSelection({ ...base, skillIds: ["user:a"] }, available),
    ).toEqual([]);
    expect(
      validateSkillSelection({ ...base, skillIds: ["user:nope"] }, available),
    ).toEqual([expect.stringMatching(/user:nope.*not installed/)]);
    expect(
      validateSkillSelection(
        { ...base, skillIds: ["workspace:repo"] },
        available,
      ),
    ).toEqual([expect.stringMatching(/workspace:repo.*import/)]);
    expect(
      validateSkillSelection(
        { ...base, superpowersEnabled: false, skillIds: ["superpowers:tdd"] },
        available,
      ),
    ).toEqual([expect.stringMatching(/Superpowers.*disabled/)]);
    expect(
      validateSkillSelection(
        { ...base, skillIds: ["user:big", "user:big2"] },
        available,
      ),
    ).toEqual([expect.stringMatching(/80000.*65536/)]);
    expect(
      validateSkillSelection(
        { ...base, skillIds: available.slice(5).map((item) => item.id) },
        available,
      ),
    ).toEqual([expect.stringMatching(/9 skills.*8/)]);
    expect(
      validateSkillSelection(
        { ...base, skillIds: ["user:a", "user:a"] },
        available,
      ),
    ).toEqual([expect.stringMatching(/more than once/)]);
    expect(
      validateSkillSelection(
        { mode: "loud" as "off", superpowersEnabled: true, skillIds: [] },
        available,
      ),
    ).toEqual([expect.stringMatching(/mode/)]);
  });
});

describe("FileSkillSettingsStore", () => {
  it("layers user, workspace, agent and session settings independently", async () => {
    const base = await temporary();
    const one = join(base, "one");
    const two = join(base, "two");
    await mkdir(one);
    await mkdir(two);
    const settings = new FileSkillSettingsStore({
      path: join(base, "config", "skill-settings.json"),
    });
    expect(await settings.getSettings({ workspaceRoot: one })).toEqual({
      mode: "automatic",
      superpowersEnabled: true,
      skillIds: [],
    });
    await settings.setSettings({}, { superpowersEnabled: false });
    await settings.setSettings({ workspaceRoot: one }, { mode: "manual" });
    await Promise.all([
      settings.setSettings(
        { workspaceRoot: one, sessionId: "s1" },
        { skillIds: ["user:a"] },
      ),
      settings.setSettings(
        { workspaceRoot: one, sessionId: "s2" },
        { mode: "off" },
      ),
      settings.setSettings(
        { workspaceRoot: one, agentId: "reviewer" },
        { skillIds: ["user:r"] },
      ),
    ]);
    expect(
      await settings.getSettings({ workspaceRoot: one, sessionId: "s1" }),
    ).toEqual({
      mode: "manual",
      superpowersEnabled: false,
      skillIds: ["user:a"],
    });
    expect(
      await settings.getSettings({ workspaceRoot: one, sessionId: "s2" }),
    ).toEqual({ mode: "off", superpowersEnabled: false, skillIds: [] });
    expect(
      await settings.getSettings({
        workspaceRoot: one,
        agentId: "reviewer",
        sessionId: "s1",
      }),
    ).toEqual({
      mode: "manual",
      superpowersEnabled: false,
      skillIds: ["user:a"],
    });
    expect(
      await settings.getSettings({ workspaceRoot: one, agentId: "reviewer" }),
    ).toEqual({
      mode: "manual",
      superpowersEnabled: false,
      skillIds: ["user:r"],
    });
    expect(await settings.getSettings({ workspaceRoot: two })).toEqual({
      mode: "automatic",
      superpowersEnabled: false,
      skillIds: [],
    });
    // Saving one field keeps the other fields saved at the same scope.
    await settings.setSettings({}, { skillIds: ["user:kept"] });
    expect(await settings.getSettings({})).toEqual({
      mode: "automatic",
      superpowersEnabled: false,
      skillIds: ["user:kept"],
    });
    await settings.setSettings({}, { skillIds: [] });
    await settings.setSettings({ workspaceRoot: one }, undefined);
    expect(await settings.getSettings({ workspaceRoot: one })).toEqual({
      mode: "automatic",
      superpowersEnabled: false,
      skillIds: [],
    });
  });

  it("rejects invalid values and scopes", async () => {
    const base = await temporary();
    const settings = new FileSkillSettingsStore({
      path: join(base, "skill-settings.json"),
    });
    await expect(
      settings.setSettings({}, { mode: "sometimes" as "off" }),
    ).rejects.toThrow(/mode/);
    await expect(
      settings.setSettings({}, { skillIds: ["no-prefix"] }),
    ).rejects.toThrow(/skill ID/);
    await expect(
      settings.setSettings({ sessionId: "s" }, { mode: "off" }),
    ).rejects.toThrow(/workspace/);
    await writeFile(join(base, "skill-settings.json"), "{not json");
    await expect(settings.getSettings({})).rejects.toThrow(/skill settings/);
  });
});
