import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import sitemap from "./sitemap";
import { siteUrl } from "./site-metadata";

async function docsPaths(
  directory: string,
  route = "/docs",
): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const children = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) =>
        docsPaths(join(directory, entry.name), `${route}/${entry.name}`),
      ),
  );
  return [
    ...(entries.some((entry) => entry.name === "page.mdx") ? [route] : []),
    ...children.flat(),
  ];
}

describe("public sitemap", () => {
  it("includes every documentation page and Android landing page once", async () => {
    const urls = sitemap().map((entry) => entry.url);
    for (const path of [
      ...(await docsPaths(new URL("./docs", import.meta.url).pathname)),
      "/truss-go",
    ]) {
      expect(
        urls.filter((url) => url === new URL(path, siteUrl).toString()),
        path,
      ).toHaveLength(1);
    }
  });
  it("does not mark unchanged pages as modified on each rebuild", () => {
    expect(
      sitemap().find(
        (entry) => entry.url === new URL("/docs", siteUrl).toString(),
      )?.lastModified,
    ).toBeUndefined();
    expect(
      sitemap().find(
        (entry) => entry.url.includes("/blog/") && entry.lastModified,
      ),
    ).toBeDefined();
  });
  it("uses the preferred production origin without configuration", () => {
    expect(siteUrl).toBe("https://www.truss-agent.com");
  });
});
