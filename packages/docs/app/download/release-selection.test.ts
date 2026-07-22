import { describe, expect, it } from "vitest";
import { selectDesktopRelease } from "./release-selection";

describe("selectDesktopRelease", () => {
  it("ignores a newer Truss Go release", () => {
    const releases = [
      { tag_name: "truss-go-v0.1.1", draft: false, prerelease: false },
      { tag_name: "v0.1.9", draft: false, prerelease: false },
    ];

    expect(selectDesktopRelease(releases)?.tag_name).toBe("v0.1.9");
  });

  it("ignores draft and prerelease desktop builds", () => {
    const releases = [
      { tag_name: "v0.2.0", draft: true, prerelease: false },
      { tag_name: "v0.1.10-beta.1", draft: false, prerelease: true },
      { tag_name: "v0.1.9", draft: false, prerelease: false },
    ];

    expect(selectDesktopRelease(releases)?.tag_name).toBe("v0.1.9");
  });
});
