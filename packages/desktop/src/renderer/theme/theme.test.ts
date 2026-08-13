import { describe, expect, it, vi } from "vitest";
import {
  applyTheme,
  parseCustomTheme,
  type ThemeRoot,
  themeDisplayName,
} from "./theme.js";

describe("renderer themes", () => {
  it("validates supported custom palette tokens", () => {
    expect(
      parseCustomTheme('{"background":"#112233","accent":"#AABBCC"}'),
    ).toEqual({ background: "#112233", accent: "#AABBCC" });
    expect(() => parseCustomTheme('{"unknown":"#112233"}')).toThrow(
      "Unknown custom theme token",
    );
    expect(() => parseCustomTheme('{"accent":"red"}')).toThrow(
      "must be a #RRGGBB color",
    );
  });

  it("clears stale tokens before applying a named or custom theme", () => {
    const root = {
      dataset: { desktopTheme: "blue" },
      style: {
        removeProperty: vi.fn(),
        setProperty: vi.fn(),
      },
    } as unknown as ThemeRoot;

    applyTheme(root, { name: "custom", custom: { accent: "#12AB34" } });
    expect(root.dataset.desktopTheme).toBe("custom");
    expect(root.style.setProperty).toHaveBeenCalledWith(
      "--desktop-accent",
      "#12AB34",
    );

    applyTheme(root, { name: "default" });
    expect(root.dataset.desktopTheme).toBeUndefined();
    expect(root.style.removeProperty).toHaveBeenCalled();
  });

  it("formats the saved-theme label", () => {
    expect(themeDisplayName({ name: "custom" })).toBe("Custom");
    expect(themeDisplayName({ name: "multicolor" })).toBe("Multicolor");
  });
});
