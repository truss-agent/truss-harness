import { describe, expect, it } from "vitest";
import {
  balancedSidebarTracks,
  clamp,
  collapsedSidebarTracks,
  expandedSidebarTracks,
  resizeSidebarTracks,
} from "./panes.js";

describe("renderer pane layout", () => {
  it("balances equal starting tracks and preserves minimums", () => {
    expect(balancedSidebarTracks(906, 6, false)).toEqual({
      git: 300,
      files: 300,
      history: 300,
    });
    expect(balancedSidebarTracks(200, 6, true)).toEqual({
      git: 38,
      files: 110,
      history: 110,
    });
    expect(clamp(700, 190, 520)).toBe(520);
  });

  it("redistributes Git height without losing total sidebar space", () => {
    const expanded = { git: 300, files: 300, history: 300 };
    const collapsed = collapsedSidebarTracks(expanded);
    expect(collapsed).toEqual({ git: 38, files: 431, history: 431 });
    const restored = expandedSidebarTracks(collapsed, 300);
    expect(restored.git + restored.files + restored.history).toBe(900);
    expect(restored.files).toBeGreaterThanOrEqual(110);
    expect(restored.history).toBeGreaterThanOrEqual(110);
  });

  it("retains track proportions when the sidebar resizes", () => {
    expect(
      resizeSidebarTracks(
        { git: 200, files: 300, history: 300 },
        1006,
        6,
        false,
      ),
    ).toEqual({ git: 250, files: 375, history: 375 });
    expect(
      resizeSidebarTracks({ git: 38, files: 400, history: 200 }, 906, 6, true),
    ).toEqual({ git: 38, files: 575, history: 287 });
  });
});
