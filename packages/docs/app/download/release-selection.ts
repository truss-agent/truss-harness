export type ReleaseMetadata = {
  readonly draft: boolean;
  readonly prerelease: boolean;
  readonly tag_name: string;
};

const desktopReleaseTag = /^v\d+(?:\.\d+){1,2}(?:$|-)/i;
const trussGoReleaseTag = /^truss-go-v\d+(?:\.\d+){1,2}(?:$|-)/i;
const neovimReleaseTag = /^nvim-v\d+(?:\.\d+){1,2}(?:$|-)/i;

function selectStableRelease<T extends ReleaseMetadata>(
  releases: readonly T[],
  tag: RegExp,
): T | undefined {
  return releases.find(
    (release) =>
      !release.draft && !release.prerelease && tag.test(release.tag_name),
  );
}

export function selectDesktopRelease<T extends ReleaseMetadata>(
  releases: readonly T[],
): T | undefined {
  return selectStableRelease(releases, desktopReleaseTag);
}

export function selectTrussGoRelease<T extends ReleaseMetadata>(
  releases: readonly T[],
): T | undefined {
  return selectStableRelease(releases, trussGoReleaseTag);
}

export function selectNeovimRelease<T extends ReleaseMetadata>(
  releases: readonly T[],
): T | undefined {
  return selectStableRelease(releases, neovimReleaseTag);
}
