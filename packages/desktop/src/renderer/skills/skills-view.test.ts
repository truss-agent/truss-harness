import { describe, expect, it } from "vitest";
import type { DesktopSkillState } from "../../shared.js";
import {
  skillRows,
  skillSummary,
  superpowersChange,
  toggledSkillIds,
} from "./skills-view.js";

const metadata = {
  resources: [],
  instructionBytes: 10,
  sha256: "x",
};
const state: DesktopSkillState = {
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
      description: "Release notes",
      source: "user",
      trusted: true,
    },
    {
      ...metadata,
      id: "workspace:local",
      name: "local",
      description: "Repo skill",
      source: "workspace",
      trusted: false,
    },
  ],
  diagnostics: [],
  selection: {
    mode: "automatic",
    superpowersEnabled: false,
    skillIds: ["superpowers:brainstorming", "user:notes"],
  },
};

describe("Desktop skills view", () => {
  it("explains why skills are unavailable and which can be removed", () => {
    expect(skillRows(state)).toEqual([
      expect.objectContaining({
        id: "superpowers:brainstorming",
        origin: "superpowers",
        selected: true,
        available: false,
        removable: false,
        note: "Superpowers is off.",
      }),
      expect.objectContaining({
        id: "user:notes",
        origin: "yours",
        available: true,
        removable: true,
      }),
      expect.objectContaining({
        id: "workspace:local",
        origin: "repository",
        available: false,
        note: expect.stringMatching(/Import/),
      }),
    ]);
    expect(skillRows(state)[1]).not.toHaveProperty("note");
  });

  it("toggles selections and drops pack skills with the pack", () => {
    expect(toggledSkillIds(state.selection, "user:notes", false)).toEqual([
      "superpowers:brainstorming",
    ]);
    expect(toggledSkillIds(state.selection, "user:notes", true)).toEqual([
      "superpowers:brainstorming",
      "user:notes",
    ]);
    expect(superpowersChange(state.selection, false)).toEqual({
      superpowersEnabled: false,
      skillIds: ["user:notes"],
    });
    expect(superpowersChange(state.selection, true)).toEqual({
      superpowersEnabled: true,
    });
  });

  it("summarizes the effective mode", () => {
    expect(skillSummary(state)).toBe(
      "Automatic: agents choose from 1 skill; 2 always active. Changes apply to the next run.",
    );
    expect(
      skillSummary({
        ...state,
        selection: { ...state.selection, mode: "manual" },
      }),
    ).toMatch(/^Manual: only the 2 selected skills run\./);
    expect(
      skillSummary({
        ...state,
        selection: { ...state.selection, mode: "off" },
      }),
    ).toMatch(/^Skills are off\./);
  });
});
