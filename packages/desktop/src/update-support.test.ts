import { describe, expect, it } from "vitest";
import {
  findReleaseAsset,
  isNewerVersion,
  releaseAssetNames,
} from "./update-support.js";

describe("desktop update support", () => {
  it("compares stable desktop versions", () => {
    expect(isNewerVersion("v0.2.0", "0.1.29")).toBe(true);
    expect(isNewerVersion("0.1.29", "0.1.29")).toBe(false);
    expect(isNewerVersion("0.1.28", "0.1.29")).toBe(false);
  });

  it("matches the artifact for the installed package and architecture", () => {
    expect(releaseAssetNames("0.2.0", "pacman", "arm64")).toEqual([
      "Truss-0.2.0-linux-arm64.pacman",
      "Truss-0.2.0-linux-arm64.pkg.tar.zst",
    ]);
    expect(
      findReleaseAsset(
        [
          {
            name: "Truss-0.2.0-linux-x64.tar.gz",
            url: "https://github.com/truss-agent/truss-harness/releases/download/v0.2.0/Truss-0.2.0-linux-x64.tar.gz",
          },
          {
            name: "Truss-0.2.0-linux-arm64.tar.gz",
            url: "https://github.com/truss-agent/truss-harness/releases/download/v0.2.0/Truss-0.2.0-linux-arm64.tar.gz",
          },
        ],
        "0.2.0",
        "archive",
        "arm64",
      )?.name,
    ).toBe("Truss-0.2.0-linux-arm64.tar.gz");
  });
});
