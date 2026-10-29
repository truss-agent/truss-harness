import { unstable_cache } from "next/cache";
import { brand } from "@truss-harness/branding";
import { fetchReleaseCatalog } from "./release-loader";

// Next's persistent cache serves stale good data during revalidation and retains it
// if the loader throws. Never catch failures inside this cached function.
const cachedReleases = unstable_cache(
  async () => {
    const repository = new URL(brand.repositoryUrl).pathname.replace(/\/$/, "");
    return fetchReleaseCatalog(
      `https://api.github.com/repos${repository}/releases`,
    );
  },
  ["public-client-releases-v1", brand.repositoryUrl],
  { revalidate: 3600 },
);

export async function getReleases() {
  try {
    return await cachedReleases();
  } catch {
    // A cold offline build/request still renders each client's release-page fallback.
    return [];
  }
}
