import { describe, expect, it } from "vitest";
import type { DesktopGitCommit } from "../../shared.js";
import {
  gitGraphRefLabel,
  gitStatusLabel,
  layoutGitGraph,
} from "./git-view.js";

describe("Git view helpers", () => {
  it("maps porcelain status pairs to concise labels", () => {
    expect(
      gitStatusLabel({
        path: "new.ts",
        indexStatus: "?",
        workTreeStatus: "?",
      }),
    ).toBe("NEW");
    expect(
      gitStatusLabel({
        path: "renamed.ts",
        indexStatus: "R",
        workTreeStatus: " ",
      }),
    ).toBe("REN");
    expect(
      gitStatusLabel({
        path: "modified.ts",
        indexStatus: " ",
        workTreeStatus: "M",
      }),
    ).toBe("MOD");
  });

  it("normalizes local, remote, and HEAD reference labels", () => {
    expect(gitGraphRefLabel("HEAD -> master")).toBe("master");
    expect(gitGraphRefLabel("refs/heads/feature")).toBe("feature");
    expect(gitGraphRefLabel("refs/remotes/origin/master")).toBe(
      "origin/master",
    );
  });

  it("projects commit ancestry into stable graph lanes", () => {
    const commit = (
      hash: string,
      parents: readonly string[],
    ): DesktopGitCommit => ({
      hash,
      shortHash: hash.slice(0, 7),
      subject: hash,
      author: "Truss",
      authoredAt: "2026-08-13T00:00:00.000Z",
      parents,
      refs: [],
    });

    const rows = layoutGitGraph([
      commit("merge", ["left", "right"]),
      commit("left", ["base"]),
      commit("right", ["base"]),
      commit("base", []),
    ]);

    expect(
      rows.map(({ commit, laneIndex }) => [commit.hash, laneIndex]),
    ).toEqual([
      ["merge", 0],
      ["left", 0],
      ["right", 1],
      ["base", 0],
    ]);
    expect(rows[0].after).toEqual(["left", "right"]);
    expect(rows[2].after).toEqual(["base"]);
  });
});
