export interface VsCodeReleaseAsset {
  readonly browser_download_url: string;
  readonly name: string;
}

export interface VsCodeRelease {
  readonly assets: readonly VsCodeReleaseAsset[];
  readonly draft: boolean;
  readonly html_url: string;
  readonly prerelease: boolean;
  readonly tag_name: string;
}

export interface AvailableVsCodeUpdate {
  readonly downloadUrl: string;
  readonly releaseUrl: string;
  readonly version: string;
}

function versionParts(version: string): readonly number[] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  return match ? match.slice(1).map(Number) : undefined;
}

export function compareVersions(left: string, right: string): number {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  if (!leftParts || !rightParts) return 0;
  for (let index = 0; index < leftParts.length; index += 1) {
    const difference = leftParts[index] - rightParts[index];
    if (difference !== 0) return difference;
  }
  return 0;
}

export function availableVsCodeUpdate(
  currentVersion: string,
  releases: readonly VsCodeRelease[],
): AvailableVsCodeUpdate | undefined {
  const latest = releases
    .filter((release) => !release.draft && !release.prerelease)
    .flatMap((release) => {
      const match = /^vscode-v(\d+\.\d+\.\d+)$/.exec(release.tag_name);
      return match ? [{ release, version: match[1] }] : [];
    })
    .sort((left, right) => compareVersions(right.version, left.version))[0];
  if (!latest || compareVersions(latest.version, currentVersion) <= 0) {
    return undefined;
  }
  const vsix = latest.release.assets.find((asset) =>
    asset.name.toLowerCase().endsWith(".vsix"),
  );
  return {
    version: latest.version,
    releaseUrl: latest.release.html_url,
    downloadUrl: vsix?.browser_download_url ?? latest.release.html_url,
  };
}
