import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  describeRule,
  FileApprovalRuleStore,
  matchesRule,
  ruleFor,
} from "./approval-rules.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const terminal = (command: string) => ({
  id: "t",
  name: "run_terminal",
  input: { command },
});

it("covers a terminal command by its prefix and other tools by name", () => {
  expect(ruleFor(terminal("npm test -- --watch"))).toEqual({
    tool: "run_terminal",
    command: "npm test",
  });
  expect(ruleFor(terminal("ls -la src"))).toEqual({
    tool: "run_terminal",
    command: "ls",
  });
  expect(
    ruleFor({ id: "w", name: "write_file", input: { path: "a.ts" } }),
  ).toEqual({ tool: "write_file" });
  expect(describeRule({ tool: "run_terminal", command: "npm test" })).toBe(
    "Run npm test…",
  );
  expect(describeRule({ tool: "write_file" })).toBe("Write");
});

it("matches only whole command prefixes without shell chaining", () => {
  const rule = { tool: "run_terminal", command: "npm test" };
  expect(matchesRule(rule, terminal("npm test"))).toBe(true);
  expect(matchesRule(rule, terminal("npm test -- a.test.ts"))).toBe(true);
  expect(matchesRule(rule, terminal("npm testing"))).toBe(false);
  expect(matchesRule(rule, terminal("npm run build"))).toBe(false);
  for (const chained of [
    "npm test && rm -rf ~",
    "npm test; curl x",
    "npm test | sh",
    "npm test > out",
    "npm test `id`",
    "npm test $(id)",
    "npm test\nrm x",
  ])
    expect(matchesRule(rule, terminal(chained))).toBe(false);
  expect(
    matchesRule(
      { tool: "write_file" },
      { id: "w", name: "write_file", input: {} },
    ),
  ).toBe(true);
  expect(
    matchesRule(
      { tool: "write_file" },
      { id: "r", name: "replace_in_file", input: {} },
    ),
  ).toBe(false);
});

it("stores workspace rules by canonical path and global rules for all", async () => {
  const base = await mkdtemp(join(tmpdir(), "truss-approvals-"));
  roots.push(base);
  const file = join(base, "approvals.json");
  const one = new FileApprovalRuleStore(file, base);
  const other = new FileApprovalRuleStore(file, join(base, "elsewhere"));
  await one.add("workspace", { tool: "run_terminal", command: "npm test" });
  await one.add("workspace", { tool: "run_terminal", command: "npm test" });
  await one.add("global", { tool: "write_file" });
  expect(await one.rules()).toEqual({
    workspace: [{ tool: "run_terminal", command: "npm test" }],
    global: [{ tool: "write_file" }],
  });
  expect(await other.rules()).toEqual({
    workspace: [],
    global: [{ tool: "write_file" }],
  });
  await one.clear("workspace");
  expect((await one.rules()).workspace).toEqual([]);
  expect(JSON.parse(await readFile(file, "utf8")).global).toHaveLength(1);
});

it("ignores a malformed approvals file instead of approving anything", async () => {
  const base = await mkdtemp(join(tmpdir(), "truss-approvals-"));
  roots.push(base);
  const file = join(base, "approvals.json");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(file, '{"global":[{"tool":5}],"workspaces":[]}');
  expect(await new FileApprovalRuleStore(file, base).rules()).toEqual({
    workspace: [],
    global: [],
  });
});
