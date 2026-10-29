import { describe, expect, it } from "vitest";
import { fetchReleaseCatalog } from "./release-loader";
import type { Release } from "./download-catalog";

const release = (tag_name: string): Release => ({
  tag_name,
  assets: [],
  draft: false,
  prerelease: false,
  published_at: "2026-01-01T00:00:00Z",
});

describe("server release catalog", () => {
  it("finds categories beyond 100 mixed releases and preserves categories without Desktop", async () => {
    const calls: string[] = [];
    const result = await fetchReleaseCatalog(
      "https://api.github.com/repos/example/project/releases",
      async (input) => {
        const url = String(input);
        calls.push(url);
        return new Response(
          JSON.stringify(
            url.endsWith("page=1")
              ? Array.from({ length: 100 }, (_, index) =>
                  release(`cli-v${index}`),
                )
              : [
                  release("vscode-v1.0.0"),
                  release("truss-go-v1.0.0"),
                  release("nvim-v1.0.0"),
                ],
          ),
        );
      },
    );
    expect(calls).toEqual([
      "https://api.github.com/repos/example/project/releases?per_page=100&page=1",
      "https://api.github.com/repos/example/project/releases?per_page=100&page=2",
    ]);
    expect(result.map((entry) => entry.tag_name)).toContain("truss-go-v1.0.0");
  });
  it("throws on API failure so the server cache cannot replace a good catalog with failure data", async () => {
    await expect(
      fetchReleaseCatalog(
        "https://api.github.com/repos/example/project/releases",
        async () => new Response("rate limited", { status: 403 }),
      ),
    ).rejects.toThrow("403");
  });
  it("rejects malformed API data instead of caching it", async () => {
    await expect(
      fetchReleaseCatalog(
        "https://api.github.com/repos/example/project/releases",
        async () => Response.json({ message: "error" }),
      ),
    ).rejects.toThrow("catalog");
  });
});
