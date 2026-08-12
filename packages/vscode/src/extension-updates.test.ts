import { describe, expect, it } from "vitest";
import {
  availableVsCodeUpdate,
  compareVersions,
  type VsCodeRelease,
} from "./extension-updates.js";

function release(
  version: string,
  options: Partial<VsCodeRelease> = {},
): VsCodeRelease {
  return {
    tag_name: `vscode-v${version}`,
    html_url: `https://github.com/truss-agent/truss-harness/releases/tag/vscode-v${version}`,
    assets: [
      {
        name: `truss-harness-vscode-${version}.vsix`,
        browser_download_url: `https://example.test/truss-harness-vscode-${version}.vsix`,
      },
    ],
    draft: false,
    prerelease: false,
    ...options,
  };
}

describe("VS Code extension updates", () => {
  it("compares numeric semantic versions", () => {
    expect(compareVersions("0.1.10", "0.1.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0", "2.0.0")).toBeLessThan(0);
  });

  it("selects the newest stable VS Code release and its VSIX", () => {
    const update = availableVsCodeUpdate("0.1.20", [
      release("0.1.21"),
      release("0.2.0", { prerelease: true }),
      release("0.1.19"),
    ]);

    expect(update).toEqual({
      version: "0.1.21",
      releaseUrl:
        "https://github.com/truss-agent/truss-harness/releases/tag/vscode-v0.1.21",
      downloadUrl: "https://example.test/truss-harness-vscode-0.1.21.vsix",
    });
  });

  it("ignores unrelated releases and versions that are not newer", () => {
    expect(
      availableVsCodeUpdate("0.1.21", [
        release("0.1.21"),
        { ...release("9.0.0"), tag_name: "v9.0.0" },
      ]),
    ).toBeUndefined();
  });

  it("falls back to the release page when no VSIX asset is present", () => {
    const candidate = release("0.1.22", { assets: [] });
    expect(availableVsCodeUpdate("0.1.21", [candidate])?.downloadUrl).toBe(
      candidate.html_url,
    );
  });
});
