export type ReleaseMetadata = {
  readonly draft: boolean;
  readonly prerelease: boolean;
  readonly tag_name: string;
};

const desktopReleaseTag = /^v\d+(?:\.\d+){1,2}(?:$|-)/i;

export function selectDesktopRelease<T extends ReleaseMetadata>(releases: readonly T[]): T | undefined {
  return releases.find(
    (release) => !release.draft && !release.prerelease && desktopReleaseTag.test(release.tag_name),
  );
}
