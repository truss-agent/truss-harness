import type { RuntimeServiceSkillState } from "@truss-harness/cli/protocol";
import { describe, expect, it } from "vitest";
import {
  nextSkillMode,
  skillPickerRows,
  superpowersSelection,
  toggledSkillSelection,
} from "./skills-controller.js";

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
    mode: "automatic",
    superpowersEnabled: false,
    skillIds: ["superpowers:brainstorming"],
  },
};

describe("TUI skill picker", () => {
  it("marks selected and unavailable skills", () => {
    expect(skillPickerRows(state)).toEqual([
      expect.objectContaining({
        id: "superpowers:brainstorming",
        selected: true,
        available: false,
        note: "pack off",
      }),
      expect.objectContaining({ id: "user:notes", available: true }),
      expect.objectContaining({
        id: "workspace:repo",
        available: false,
        note: "untrusted: import to use",
      }),
    ]);
  });

  it("selects available skills and only clears unavailable ones", () => {
    const [pack, notes, repo] = skillPickerRows(state);
    expect(notes && toggledSkillSelection(state, notes)).toEqual({
      skillIds: ["superpowers:brainstorming", "user:notes"],
    });
    expect(pack && toggledSkillSelection(state, pack)).toEqual({
      skillIds: [],
    });
    expect(repo && toggledSkillSelection(state, repo)).toBeUndefined();
  });

  it("cycles modes and keeps runs valid when the pack changes", () => {
    expect(nextSkillMode("automatic")).toBe("manual");
    expect(nextSkillMode("manual")).toBe("off");
    expect(nextSkillMode("off")).toBe("automatic");
    expect(superpowersSelection(state.selection)).toEqual({
      superpowersEnabled: true,
    });
    expect(
      superpowersSelection({ ...state.selection, superpowersEnabled: true }),
    ).toEqual({ superpowersEnabled: false, skillIds: [] });
  });
});
