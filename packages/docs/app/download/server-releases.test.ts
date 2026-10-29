import { AsyncLocalStorage } from "node:async_hooks";
import { afterEach, describe, expect, it, vi } from "vitest";

// Exercise the real Next cache adapter; only transport and persistent storage are
// replaced. A failed refresh must not cache [] over a previously good release.
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("server release cache integration", () => {
  it("serves stale good releases when an expired catalog cannot refresh", async () => {
    vi.stubGlobal("AsyncLocalStorage", AsyncLocalStorage);
    const { workAsyncStorage } = await import(
      new URL(
        "../../node_modules/next/dist/server/app-render/work-async-storage.external.js",
        import.meta.url,
      ).href
    );
    const { getReleases } = await import("./server-releases");
    const good = [
      {
        tag_name: "truss-go-v1.0.0",
        draft: false,
        prerelease: false,
        assets: [],
        published_at: "2026-01-01T00:00:00Z",
      },
    ];
    let stored:
      | { kind: string; data: { body: string }; revalidate: number }
      | undefined;
    let stale = false;
    let offline = false;
    const cache = {
      isOnDemandRevalidate: false,
      generateCacheKey: async (key: string) => key,
      get: async () => (stored ? { value: stored, isStale: stale } : null),
      set: async (_key: string, value: typeof stored) => {
        stored = value;
      },
    };
    vi.stubGlobal("fetch", async () =>
      offline
        ? new Response("unavailable", { status: 503 })
        : Response.json(good),
    );
    const render = () =>
      workAsyncStorage.run(
        { route: "/download", incrementalCache: cache, isRevalidate: true },
        getReleases,
      );
    expect(await render()).toEqual(good);
    expect(stored?.revalidate).toBe(3600);
    offline = true;
    stale = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await render()).toEqual(good);
    stale = false;
    expect(await render()).toEqual(good);
    stored = undefined;
    expect(await render()).toEqual([]);
    expect(stored).toBeUndefined();
  });
});
