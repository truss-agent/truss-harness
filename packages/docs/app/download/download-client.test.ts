import * as React from "react";
import { createRequire } from "node:module";

import { afterAll, describe, expect, it, vi } from "vitest";
import { DownloadClient } from "./download-client";
import type { Release } from "./download-catalog";

const {
  renderToStaticMarkup,
}: { renderToStaticMarkup(element: React.ReactElement): string } =
  createRequire(import.meta.url)("react-dom/server");

vi.stubGlobal("React", React);
afterAll(() => vi.unstubAllGlobals());

const releases: Release[] = [
  ["vscode-v1.0.0", "client.vsix"],
  ["truss-go-v1.0.0", "client.apk"],
  ["nvim-v1.0.0", "client.tar.gz"],
].map(([tag_name, name]) => ({
  tag_name,
  draft: false,
  prerelease: false,
  published_at: "2026-01-01T00:00:00Z",
  assets: [
    { name, size: 42, browser_download_url: `https://example.test/${name}` },
  ],
}));

describe("independent downloads", () => {
  it("renders available VS Code, Android and Neovim assets when Desktop is absent", () => {
    const html = renderToStaticMarkup(
      React.createElement(DownloadClient, {
        releases,
        releasesUrl: "https://example.test/releases",
      }),
    );
    expect(html).toContain('href="https://example.test/client.vsix"');
    expect(html).toContain('href="https://example.test/client.apk"');
    expect(html).toContain('href="https://example.test/client.tar.gz"');
    expect(html).toContain("Release unavailable");
  });
  it("keeps fallback links and other categories usable when one asset is absent", () => {
    const html = renderToStaticMarkup(
      React.createElement(DownloadClient, {
        releases: releases.map((release, index) =>
          index === 0 ? { ...release, assets: [] } : release,
        ),
        releasesUrl: "https://example.test/releases",
      }),
    );
    expect(html).not.toContain('href="https://example.test/client.vsix"');
    expect(html).toContain('href="https://example.test/client.apk"');
    expect(html).toContain('href="https://example.test/releases"');
  });
});
