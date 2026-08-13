import { describe, expect, it } from "vitest";
import { DesktopEditorController } from "./editor-controller.js";

describe("DesktopEditorController", () => {
  it("owns tab selection, close fallback, and diff state", () => {
    const controller = new DesktopEditorController("__settings__");
    const first = controller.add("src\\first.ts", "file", "ready");
    const second = controller.add("src/second.ts", "diff", "ready");
    controller.select(second);

    expect(controller.activePath).toBe("src/second.ts");
    expect(controller.showingDiff).toBe(true);
    const result = controller.close(second.path);
    expect(result).toMatchObject({
      wasActive: true,
      next: first,
    });
    expect(controller.activePath).toBeUndefined();
    if (result.next) controller.select(result.next);
    expect(controller.activePath).toBe("src/first.ts");
  });

  it("excludes the virtual Settings tab from persistence and file context", () => {
    const controller = new DesktopEditorController("__settings__");
    controller.add("src/index.ts", "file", "ready");
    const settings = controller.add("__settings__", "settings", "ready");
    controller.select(settings);

    expect(controller.activeWorkspacePath()).toBeUndefined();
    expect(controller.persistedTabs()).toEqual([
      { path: "src/index.ts", mode: "file", scrollTop: 0 },
    ]);
  });

  it("restores bounded editor state and removes renamed directory children", () => {
    const controller = new DesktopEditorController("__settings__");
    controller.restore(
      [
        { path: "src/a.ts", mode: "file", scrollTop: 10 },
        { path: "src/b.ts", mode: "diff", scrollTop: 20 },
      ],
      "src/a.ts",
    );

    expect(controller.activePath).toBe("src/a.ts");
    expect(controller.removeEntries("src", true).removedActive).toBe(true);
    expect(controller.tabs).toEqual([]);
  });

  it("reports only syntax-error presence transitions", () => {
    const controller = new DesktopEditorController("__settings__");
    expect(
      controller.setDiagnostics("src/index.ts", [
        { line: 1, message: "Unexpected token" },
      ]),
    ).toBe(true);
    expect(
      controller.setDiagnostics("src/index.ts", [
        { line: 2, message: "Still invalid" },
      ]),
    ).toBe(false);
    expect(controller.setDiagnostics("src/index.ts", [])).toBe(true);
  });
});
