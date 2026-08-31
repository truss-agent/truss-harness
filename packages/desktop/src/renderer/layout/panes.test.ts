import { describe, expect, it } from "vitest";
import {
  balancedSidebarTracks,
  clamp,
  collapsedSidebarTracks,
  expandedSidebarTracks,
  resizeSidebarTracks,
} from "./panes.js";

describe("renderer pane layout", () => {
  it("balances Git and Files tracks and preserves minimums", () => {
    expect(balancedSidebarTracks(906, 6, false)).toEqual({
      git: 342,
      files: 558,
    });
    expect(balancedSidebarTracks(200, 6, true)).toEqual({
      git: 38,
      files: 156,
    });
    expect(clamp(700, 190, 520)).toBe(520);
  });

  it("redistributes Git height without losing total sidebar space", () => {
    const expanded = { git: 300, files: 600 };
    const collapsed = collapsedSidebarTracks(expanded);
    expect(collapsed).toEqual({ git: 38, files: 862 });
    const restored = expandedSidebarTracks(collapsed, 300);
    expect(restored.git + restored.files).toBe(900);
    expect(restored.files).toBeGreaterThanOrEqual(110);
  });

  it("preserves a practical Files area when the sidebar resizes", () => {
    expect(
      resizeSidebarTracks({ git: 200, files: 700 }, 1006, 6, false),
    ).toEqual({ git: 200, files: 800 });
    expect(
      resizeSidebarTracks({ git: 38, files: 862 }, 906, 6, true),
    ).toEqual({ git: 38, files: 862 });
  });
});
