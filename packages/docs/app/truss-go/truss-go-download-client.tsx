"use client";

import { useEffect, useState } from "react";

type ReleaseAsset = { readonly browser_download_url: string; readonly name: string };
type Release = {
  readonly assets: readonly ReleaseAsset[];
  readonly draft: boolean;
  readonly prerelease: boolean;
  readonly tag_name: string;
};

export function TrussGoDownloadClient({ apiUrl, releasesUrl }: { readonly apiUrl: string; readonly releasesUrl: string }) {
  const [apk, setApk] = useState<ReleaseAsset>();

  useEffect(() => {
    const controller = new AbortController();
    fetch(apiUrl, { headers: { Accept: "application/vnd.github+json" }, signal: controller.signal })
      .then((response) => response.ok ? response.json() as Promise<readonly Release[]> : Promise.reject(new Error(`GitHub returned ${response.status}`)))
      .then((releases) => releases.find((release) => !release.draft && !release.prerelease && release.tag_name.startsWith("truss-go-v")))
      .then((release) => setApk(release?.assets.find((asset) => asset.name.toLowerCase().endsWith(".apk"))))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
      });
    return () => controller.abort();
  }, [apiUrl]);

  return apk ? (
    <a className="site-button site-button-primary" href={apk.browser_download_url}>Download Android APK</a>
  ) : (
    <a className="site-button site-button-secondary" href={releasesUrl} target="_blank" rel="noreferrer">View Android releases</a>
  );
}
