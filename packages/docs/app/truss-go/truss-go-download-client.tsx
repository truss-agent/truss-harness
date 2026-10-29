import type { Release } from "../download/download-catalog";
import { selectTrussGoRelease } from "../download/release-selection";

export function TrussGoDownloadClient({
  releases,
  releasesUrl,
}: {
  readonly releases: readonly Release[];
  readonly releasesUrl: string;
}) {
  const apk = selectTrussGoRelease(releases)?.assets.find((asset) =>
    asset.name.toLowerCase().endsWith(".apk"),
  );
  return apk ? (
    <a
      className="site-button site-button-primary"
      href={apk.browser_download_url}
    >
      Download Android APK
    </a>
  ) : (
    <a
      className="site-button site-button-secondary"
      href={releasesUrl}
      target="_blank"
      rel="noreferrer"
    >
      View Android releases
    </a>
  );
}
