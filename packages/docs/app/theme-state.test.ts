import { describe, expect, it } from "vitest";
import { createThemeStore } from "./theme-state";

describe("shared site theme", () => {
  it("updates both subscribers and the applied theme when either control toggles", () => {
    const applied: string[] = [];
    let saved = "dark";
    const store = createThemeStore({
      read: () => saved,
      write: (theme) => {
        saved = theme;
      },
      prefersDark: () => false,
      apply: (theme) => applied.push(theme),
    });
    store.initialize();
    const desktop: string[] = [],
      mobile: string[] = [];
    const unsubscribe = store.subscribe(() =>
      desktop.push(store.getSnapshot()),
    );
    store.subscribe(() => mobile.push(store.getSnapshot()));
    store.toggle();
    store.toggle();
    expect(desktop).toEqual(["light", "dark"]);
    expect(mobile).toEqual(["light", "dark"]);
    expect(applied).toEqual(["dark", "light", "dark"]);
    expect(saved).toBe("dark");
    unsubscribe();
    store.set("light");
    expect(desktop).toHaveLength(2);
    expect(mobile).toEqual(["light", "dark", "light"]);
  });
  it("applies and switches the theme even when storage reads and writes are denied", () => {
    const applied: string[] = [];
    const store = createThemeStore({
      read: () => {
        throw new Error("denied");
      },
      write: () => {
        throw new Error("denied");
      },
      prefersDark: () => true,
      apply: (theme) => applied.push(theme),
    });
    store.initialize();
    store.toggle();
    expect(store.getSnapshot()).toBe("light");
    expect(applied).toEqual(["dark", "light"]);
  });
});
