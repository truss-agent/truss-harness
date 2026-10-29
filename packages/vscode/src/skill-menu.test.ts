import type { RuntimeServiceSkillState } from "@truss-harness/cli/protocol";
import { describe, expect, it } from "vitest";
import {
  selectableSkills,
  skillMenuItems,
  skillStatusText,
  superpowersToggle,
} from "./skill-menu.js";

const metadata = { resources: [], instructionBytes: 1, sha256: "x" };
const state: RuntimeServiceSkillState = {
  skills: [
    {
      ...metadata,
      id: "superpowers:brainstorming",
      name: "brainstorming",
      description: "Design first",
      source: "bundled",
      bundle: "superpowers",
      trusted: true,
    },
    {
      ...metadata,
      id: "user:notes",
      name: "notes",
      description: "Notes",
      source: "user",
      trusted: true,
    },
    {
      ...metadata,
      id: "workspace:repo",
      name: "repo",
      description: "Repo",
      source: "workspace",
      trusted: false,
    },
  ],
  diagnostics: [],
  selection: {
    mode: "manual",
    superpowersEnabled: true,
    skillIds: ["superpowers:brainstorming"],
  },
};

describe("VS Code skill menu", () => {
  it("offers management only when the host supports it", () => {
    expect(
      skillMenuItems(state, "user", false).map((item) => item.action),
    ).toEqual(["scope", "mode", "superpowers", "select"]);
    const managed = skillMenuItems(state, "workspace", true);
    expect(managed.map((item) => item.action)).toEqual([
      "scope",
      "mode",
      "superpowers",
      "select",
      "import",
      "remove",
      "reset",
    ]);
    expect(managed[0]?.label).toBe("Save changes for: This workspace");
    expect(managed[4]?.detail).toMatch(/1 repository skill must be imported/);
  });

  it("keeps runs valid when the pack is turned off", () => {
    expect(superpowersToggle(state.selection)).toEqual({
      superpowersEnabled: false,
      skillIds: [],
    });
    const off = {
      ...state,
      selection: { ...state.selection, superpowersEnabled: false },
    };
    expect(selectableSkills(off).map((skill) => skill.id)).toEqual([
      "user:notes",
    ]);
    expect(superpowersToggle(off.selection)).toEqual({
      superpowersEnabled: true,
    });
  });

  it("describes the effective selection", () => {
    expect(skillStatusText(state)).toBe(
      "Manual skills, 1 always active. Changes apply to the next run.",
    );
  });
});
