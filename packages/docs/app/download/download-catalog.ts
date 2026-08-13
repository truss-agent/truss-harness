export type ReleaseAsset = {
  readonly browser_download_url: string;
  readonly name: string;
  readonly size: number;
};

export type Release = {
  readonly assets: readonly ReleaseAsset[];
  readonly draft: boolean;
  readonly prerelease: boolean;
  readonly published_at: string;
  readonly tag_name: string;
};

export type DesktopBuild = {
  readonly arch: "x64" | "arm64";
  readonly extension: string;
  readonly format: string;
  readonly note: string;
  readonly platform: "windows" | "linux";
};

export const desktopBuilds: readonly DesktopBuild[] = [
  {
    platform: "windows",
    arch: "x64",
    format: "Windows installer",
    extension: ".exe",
    note: "Intel and AMD PCs",
  },
  {
    platform: "windows",
    arch: "arm64",
    format: "Windows installer",
    extension: ".exe",
    note: "Snapdragon and ARM PCs",
  },
  {
    platform: "linux",
    arch: "x64",
    format: "Portable archive",
    extension: ".tar.gz",
    note: "All distributions",
  },
  {
    platform: "linux",
    arch: "arm64",
    format: "Portable archive",
    extension: ".tar.gz",
    note: "ARM Linux",
  },
  {
    platform: "linux",
    arch: "x64",
    format: "Debian package",
    extension: ".deb",
    note: "Debian, Ubuntu, and Mint",
  },
  {
    platform: "linux",
    arch: "arm64",
    format: "Debian package",
    extension: ".deb",
    note: "Debian and Ubuntu on ARM",
  },
  {
    platform: "linux",
    arch: "x64",
    format: "RPM package",
    extension: ".rpm",
    note: "Fedora, RHEL, and openSUSE",
  },
  {
    platform: "linux",
    arch: "arm64",
    format: "RPM package",
    extension: ".rpm",
    note: "RPM-based ARM systems",
  },
  {
    platform: "linux",
    arch: "x64",
    format: "Arch package",
    extension: ".pacman",
    note: "Arch Linux and Manjaro",
  },
  {
    platform: "linux",
    arch: "arm64",
    format: "Arch package",
    extension: ".pacman",
    note: "Arch Linux ARM",
  },
];

export type DetectedBuild = Pick<DesktopBuild, "platform" | "arch">;

export function formatAssetSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function assetMatchesBuild(
  asset: ReleaseAsset,
  build: DesktopBuild,
): boolean {
  const name = asset.name.toLowerCase();
  const platformMatches =
    build.platform === "windows"
      ? name.includes("win")
      : name.includes("linux");
  const archMatches =
    build.arch === "x64"
      ? /(?:^|[-_.])(x64|amd64|x86_64)(?:[-_.]|$)/.test(name)
      : /(?:^|[-_.])(arm64|aarch64)(?:[-_.]|$)/.test(name);
  const extensionMatches =
    build.extension === ".pacman"
      ? name.endsWith(".pacman") || name.endsWith(".pkg.tar.zst")
      : build.extension === ".tar.gz"
        ? name.endsWith(".tar.gz")
        : name.endsWith(build.extension);
  return platformMatches && archMatches && extensionMatches;
}

export function detectDesktopBuild(
  userAgent: string,
): DetectedBuild | undefined {
  const agent = userAgent.toLowerCase();
  const platform = agent.includes("windows")
    ? "windows"
    : agent.includes("linux")
      ? "linux"
      : undefined;
  if (!platform) return undefined;
  return { platform, arch: /arm64|aarch64/.test(agent) ? "arm64" : "x64" };
}

export function releaseDate(release: Release | undefined): string | undefined {
  return release?.published_at
    ? new Date(release.published_at).toLocaleDateString(undefined, {
        dateStyle: "medium",
      })
    : undefined;
}

export function desktopBuildKey(build: DesktopBuild): string {
  return `${build.platform}:${build.arch}:${build.extension}`;
}

export function desktopBuildLabel(build: DesktopBuild): string {
  return `${build.format} · ${build.arch === "x64" ? "x64 / AMD64" : "ARM64"}`;
}

export function detectedBuildLabel(build: DetectedBuild): string {
  return `${build.platform === "windows" ? "Windows" : "Linux"} ${build.arch === "x64" ? "x64" : "ARM64"}`;
}

export function recommendedDesktopBuild(
  detected: DetectedBuild | undefined,
): DesktopBuild | undefined {
  return desktopBuilds.find(
    (build) =>
      build.platform === detected?.platform &&
      build.arch === detected.arch &&
      (build.platform === "windows" || build.extension === ".tar.gz"),
  );
}
