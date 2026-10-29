import type { Release } from "./download-catalog";
import {
  selectDesktopRelease,
  selectNeovimRelease,
  selectTrussGoRelease,
  selectVscodeRelease,
} from "./release-selection";

function isRelease(value: unknown): value is Release {
  if (!value || typeof value !== "object") return false;
  const release = value as Partial<Release>;
  return (
    typeof release.tag_name === "string" &&
    typeof release.draft === "boolean" &&
    typeof release.prerelease === "boolean" &&
    typeof release.published_at === "string" &&
    Array.isArray(release.assets) &&
    release.assets.every((asset: unknown) => {
      if (!asset || typeof asset !== "object") return false;
      const item = asset as Record<string, unknown>;
      return (
        typeof item.name === "string" &&
        typeof item.browser_download_url === "string" &&
        typeof item.size === "number"
      );
    })
  );
}

/** Scan mixed release history until all clients are found, or history ends. */
export async function fetchReleaseCatalog(
  apiUrl: string,
  request: typeof fetch = fetch,
): Promise<readonly Release[]> {
  const releases: Release[] = [];
  const signal = AbortSignal.timeout(15000);
  // Bound upstream work even if a client has never published. Available clients remain usable.
  for (let page = 1; page <= 10; page += 1) {
    const url = new URL(apiUrl);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    const response = await request(url.toString(), {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-store",
      signal,
    });
    if (!response.ok)
      throw new Error(`Release catalog returned ${response.status}`);
    const batch: unknown = await response.json();
    if (!Array.isArray(batch) || !batch.every(isRelease))
      throw new Error("Invalid release catalog");
    releases.push(...batch);
    if (
      batch.length < 100 ||
      [
        selectDesktopRelease,
        selectNeovimRelease,
        selectTrussGoRelease,
        selectVscodeRelease,
      ].every((select) => select(releases))
    )
      break;
  }
  return releases;
}
