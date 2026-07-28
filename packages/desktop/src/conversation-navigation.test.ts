import { describe, expect, it, vi } from "vitest";
import { scheduleConversationNavigation } from "./conversation-navigation.js";

describe("scheduleConversationNavigation", () => {
  it("defers list replacement and restores focus after rendering", () => {
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
      render: () => calls.push("render"),
      restoreFocus: () => calls.push("focus"),
    });

    expect(frame).toBe(23);
    expect(cancelFrame).toHaveBeenCalledWith(17);
    expect(calls).toEqual(["save"]);

    scheduled?.();
    expect(calls).toEqual(["save", "render", "focus"]);
  });
});
