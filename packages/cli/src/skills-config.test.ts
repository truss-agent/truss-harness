import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseConfigurationOverrides,
  resolveConfiguration,
  trustWorkspaceConfiguration,
} from "./config.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function setup(user: object, workspace?: object) {
  const root = join(process.cwd(), ".test-workspaces", randomUUID());
  roots.push(root);
  await mkdir(root, { recursive: true });
  const paths = {
    user: join(root, "config", "user.json"),
    workspace: join(root, "workspace.json"),
  };
  await mkdir(join(root, "config"));
  await writeFile(paths.user, JSON.stringify({ model: "m", ...user }));
  if (workspace) await writeFile(paths.workspace, JSON.stringify(workspace));
  return { root, paths };
}
const effective = async (
  resolved: Awaited<ReturnType<typeof resolveConfiguration>>,
  sessionId?: string,
) =>
  resolved.skills.selection({
    agentId: "single-agent",
    ...(sessionId ? { sessionId } : {}),
  });

describe("skill configuration", () => {
  it("defaults to Automatic with Superpowers on", async () => {
    const { root, paths } = await setup({});
    const resolved = await resolveConfiguration({
      workspaceRoot: root,
      paths,
      environment: {},
    });
    expect(await effective(resolved)).toEqual({
      mode: "automatic",
      superpowersEnabled: true,
      skillIds: [],
    });
  });

  it("layers config defaults, saved settings, environment and flags", async () => {
    const { root, paths } = await setup({
      skillMode: "manual",
      superpowersEnabled: false,
      skillIds: ["user:notes"],
    });
    const configured = await resolveConfiguration({
      workspaceRoot: root,
      paths,
      environment: {},
    });
    expect(await effective(configured)).toEqual({
      mode: "manual",
      superpowersEnabled: false,
      skillIds: ["user:notes"],
    });
    // A saved per-session choice outranks config defaults.
    await configured.skills.settings.setSettings(
      { workspaceRoot: root, sessionId: "s1" },
      { mode: "automatic" },
    );
    expect((await effective(configured, "s1")).mode).toBe("automatic");

    const explicit = await resolveConfiguration({
      workspaceRoot: root,
      paths,
      environment: { TRUSS_HARNESS_SUPERPOWERS_ENABLED: "on" },
      overrides: parseConfigurationOverrides(["--skills-mode", "off"])
        .overrides,
    });
    expect(await effective(explicit, "s1")).toEqual({
      mode: "off",
      superpowersEnabled: true,
      skillIds: ["user:notes"],
    });
    expect(
      (
        await effective(
          await resolveConfiguration({
            workspaceRoot: root,
            paths,
            environment: { TRUSS_HARNESS_SKILLS_MODE: "automatic" },
            overrides: parseConfigurationOverrides(["--superpowers", "off"])
              .overrides,
          }),
          "s1",
        )
      ).superpowersEnabled,
    ).toBe(false);
  });

  it("ignores skill settings in an untrusted workspace config", async () => {
    const { root, paths } = await setup({}, { skillMode: "off" });
    const untrusted = await resolveConfiguration({
      workspaceRoot: root,
      paths,
      environment: {},
    });
    expect((await effective(untrusted)).mode).toBe("automatic");
    await trustWorkspaceConfiguration(root, paths);
    const trusted = await resolveConfiguration({
      workspaceRoot: root,
      paths,
      environment: {},
    });
    expect((await effective(trusted)).mode).toBe("off");
  });

  it("rejects invalid skill values clearly", async () => {
    expect(() =>
      parseConfigurationOverrides(["--skills-mode", "loud"]),
    ).toThrow(/automatic, manual, or off/);
    expect(() =>
      parseConfigurationOverrides(["--superpowers", "maybe"]),
    ).toThrow(/on or off/);
    const { root, paths } = await setup({ skillMode: "sometimes" });
    await expect(
      resolveConfiguration({ workspaceRoot: root, paths, environment: {} }),
    ).rejects.toThrow(/skill mode/);
    const environment = await setup({});
    await expect(
      resolveConfiguration({
        workspaceRoot: environment.root,
        paths: environment.paths,
        environment: { TRUSS_HARNESS_SUPERPOWERS_ENABLED: "maybe" },
      }),
    ).rejects.toThrow(/TRUSS_HARNESS_SUPERPOWERS_ENABLED/);
  });
});
