import { describe, expect, it } from "vitest";
import {
  assetMatchesBuild,
  desktopBuilds,
  detectDesktopBuild,
  recommendedDesktopBuild,
} from "./download-catalog";

describe("download catalog", () => {
  it("detects supported desktop platforms and their architecture", () => {
    expect(detectDesktopBuild("Mozilla/5.0 (X11; Linux aarch64)")).toEqual({
      platform: "linux",
      arch: "arm64",
    });
    expect(
      detectDesktopBuild("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"),
    ).toEqual({ platform: "windows", arch: "x64" });
    expect(detectDesktopBuild("Mozilla/5.0 (Macintosh)")).toBeUndefined();
  });

  it("selects portable Linux and Windows installer defaults", () => {
    expect(
      recommendedDesktopBuild({ platform: "linux", arch: "x64" }),
    ).toMatchObject({ extension: ".tar.gz" });
    expect(
      recommendedDesktopBuild({ platform: "windows", arch: "arm64" }),
    ).toMatchObject({ extension: ".exe" });
  });

  it("matches platform, architecture, and package extension", () => {
    const archBuild = desktopBuilds.find(
      (build) =>
        build.platform === "linux" &&
        build.arch === "x64" &&
        build.extension === ".pacman",
    )!;
    expect(
      assetMatchesBuild(
        {
          name: "Truss-0.1.5-linux-x64.pacman",
          size: 1,
          browser_download_url: "https://example.test/truss",
        },
        archBuild,
      ),
    ).toBe(true);
    expect(
      assetMatchesBuild(
        {
          name: "Truss-0.1.5-linux-arm64.pacman",
          size: 1,
          browser_download_url: "https://example.test/truss",
        },
        archBuild,
      ),
    ).toBe(false);
  });
});
