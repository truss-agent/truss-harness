import { describe, expect, it } from "vitest";
import {
  childEntryPath,
  normalizedWorkspaceEntry,
  WorkspaceFilesController,
} from "./workspace-files-controller.js";

describe("WorkspaceFilesController", () => {
  it("normalizes and merges directory listings without duplicates", () => {
    const controller = new WorkspaceFilesController();
    controller.replace([{ path: "src/index.ts", type: "file" }]);
    controller.merge([
      { path: "src\\index.ts", type: "file" },
      { path: "src/new.ts", type: "file" },
    ]);

    expect(controller.entries.map((entry) => entry.path)).toEqual([
      "src/index.ts",
      "src/new.ts",
    ]);
  });

  it("owns expansion and directory loading state", () => {
    const controller = new WorkspaceFilesController();
    expect(controller.toggleExpanded("src")).toBe(true);
    expect(controller.isExpanded("src")).toBe(true);
    expect(controller.needsDirectory("src")).toBe(true);
    controller.markDirectoryLoaded("src");
    expect(controller.needsDirectory("src")).toBe(false);

    controller.moveDirectoryState("src", "source");
    expect(controller.isExpanded("source")).toBe(true);
    expect(controller.needsDirectory("source")).toBe(true);
  });

  it("clears copied files when their parent directory is deleted", () => {
    const controller = new WorkspaceFilesController();
    controller.copiedPath = "src/index.ts";
    controller.clearCopiedWithin("src", true);
    expect(controller.copiedPath).toBeUndefined();
  });

  it("rejects absolute and traversing file-action paths", () => {
    expect(normalizedWorkspaceEntry("../secret")).toBeUndefined();
    expect(normalizedWorkspaceEntry("/tmp/file")).toBeUndefined();
    expect(normalizedWorkspaceEntry("C:\\temp\\file")).toBeUndefined();
    expect(childEntryPath("src", "nested/file.ts")).toBe("src/nested/file.ts");
  });
});
