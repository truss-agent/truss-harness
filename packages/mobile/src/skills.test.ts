import { describe, expect, it, vi } from "vitest";
import type { RemoteSkillState, Workspace } from "./contracts";
import {
  listRemoteSkills,
  supportsSkills,
  toggledSkill,
  toggledSuperpowers,
  updateRemoteSkills,
} from "./skills";

const state: RemoteSkillState = {
  skills: [
    {
      id: "superpowers:brainstorming",
      name: "brainstorming",
      description: "Design first",
      source: "bundled",
      bundle: "superpowers",
      trusted: true,
    },
    {
      id: "user:notes",
      name: "notes",
      description: "Notes",
      source: "user",
      trusted: true,
    },
    {
      id: "workspace:repo",
      name: "repo",
      description: "Repo",
      source: "workspace",
      trusted: false,
    },
  ],
  selection: {
    mode: "manual",
    superpowersEnabled: true,
    skillIds: ["superpowers:brainstorming"],
  },
};

const workspace = (capabilities: Partial<Workspace["capabilities"]>) =>
  ({
    id: "w",
    displayName: "W",
    capabilities: { modes: ["chat"], ...capabilities },
  }) as Workspace;

describe("mobile skills", () => {
  it("needs host support and protocol version 2", () => {
    expect(supportsSkills(workspace({ supportsSkills: true }))).toBe(false);
    expect(
      supportsSkills(
        workspace({ supportsSkills: true, protocolVersions: [1, 2] }),
      ),
    ).toBe(true);
    expect(supportsSkills(workspace({ protocolVersions: [2] }))).toBe(false);
  });

  it("lists and saves through version 2 gateway commands", async () => {
    const command = vi.fn(async () => ({ type: "skills_listed", ...state }));
    expect(await listRemoteSkills(command, "w")).toEqual(state);
    await updateRemoteSkills(command, "w", "session", "s1", { mode: "off" });
    expect(command.mock.calls).toEqual([
      [{ type: "list_skills", workspaceId: "w" }, 2],
      [
        {
          type: "update_skill_settings",
          workspaceId: "w",
          scope: "session",
          sessionId: "s1",
          selection: { mode: "off" },
        },
        2,
      ],
    ]);
    await expect(
      updateRemoteSkills(command, "w", "session", undefined, null),
    ).rejects.toThrow(/Open a conversation/);
    await expect(
      listRemoteSkills(async () => ({ type: "rejected" }), "w"),
    ).rejects.toThrow(/did not return skills/);
  });

  it("toggles skills and keeps runs valid when the pack changes", () => {
    const [pack, notes, repo] = state.skills;
    expect(notes && toggledSkill(state, notes)).toEqual({
      skillIds: ["superpowers:brainstorming", "user:notes"],
    });
    expect(repo && toggledSkill(state, repo)).toBeUndefined();
    expect(pack && toggledSkill(state, pack)).toEqual({ skillIds: [] });
    expect(toggledSuperpowers(state.selection)).toEqual({
      superpowersEnabled: false,
      skillIds: [],
    });
  });
});
