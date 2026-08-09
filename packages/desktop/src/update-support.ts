export type DesktopUpdateArtifact =
  | "windows"
  | "appimage"
  | "deb"
  | "rpm"
  | "pacman"
  | "archive";

export interface DesktopReleaseAsset {
  readonly name: string;
  readonly url: string;
}

export function normalizedVersion(value: string): string | undefined {
  const normalized = value.trim().replace(/^v/i, "");
  return /^\d+(?:\.\d+){2}(?:[-+][0-9A-Za-z.-]+)?$/.test(normalized)
    ? normalized
    : undefined;
}

export function isNewerVersion(latest: string, current: string): boolean {
  const latestParts = normalizedVersion(latest)?.split(/[.+-]/).map(Number);
  const currentParts = normalizedVersion(current)?.split(/[.+-]/).map(Number);
  if (!latestParts || !currentParts) return false;
  for (let index = 0; index < 3; index += 1) {
    const difference = (latestParts[index] ?? 0) - (currentParts[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}

export function releaseAssetNames(
  version: string,
  artifact: DesktopUpdateArtifact,
  arch: string,
): readonly string[] {
  const platform = artifact === "windows" ? "win" : "linux";
  const base = "Truss-" + version + "-" + platform + "-" + arch;
  switch (artifact) {
    case "windows":
      return [base + ".exe"];
    case "appimage":
      return [base + ".AppImage"];
    case "deb":
      return [base + ".deb"];
    case "rpm":
      return [base + ".rpm"];
    case "pacman":
      return [base + ".pacman", base + ".pkg.tar.zst"];
    case "archive":
      return [base + ".tar.gz"];
  }
}

export function findReleaseAsset(
  assets: readonly DesktopReleaseAsset[],
  version: string,
  artifact: DesktopUpdateArtifact,
  arch: string,
): DesktopReleaseAsset | undefined {
  const names = new Set(releaseAssetNames(version, artifact, arch));
  return assets.find((asset) => names.has(asset.name));
}
