import { describe, expect, it, vi } from "vitest";
import { scheduleConversationNavigation } from "./conversation-navigation.js";

describe("scheduleConversationNavigation", () => {
  it("releases the clicked button before replacing the list", () => {
    const calls: string[] = [];
    let scheduled: (() => void) | undefined;
    const cancelFrame = vi.fn();

    const frame = scheduleConversationNavigation(17, {
      save: () => calls.push("save"),
      cancelFrame,
      requestFrame: (callback) => {
        scheduled = callback;
        return 23;
      },
      releaseFocus: () => calls.push("release"),
      render: () => calls.push("render"),
      restoreFocus: () => calls.push("focus"),
    });

    expect(frame).toBe(23);
    expect(cancelFrame).toHaveBeenCalledWith(17);
    expect(calls).toEqual(["save", "release"]);

    scheduled?.();
    expect(calls).toEqual(["save", "release", "render", "focus"]);
  });
});
