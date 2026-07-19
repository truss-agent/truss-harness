"use client";

import { useEffect, useMemo, useState } from "react";

type ReleaseAsset = {
  browser_download_url: string;
  name: string;
  size: number;
};

type Release = {
  assets: ReleaseAsset[];
  published_at: string;
  tag_name: string;
};

type Build = {
  arch: "x64" | "arm64";
  extension: string;
  format: string;
  note: string;
  platform: "windows" | "linux";
};

const builds: Build[] = [
  { platform: "windows", arch: "x64", format: "Windows installer", extension: ".exe", note: "Intel and AMD PCs" },
  { platform: "windows", arch: "arm64", format: "Windows installer", extension: ".exe", note: "Snapdragon and ARM PCs" },
  { platform: "linux", arch: "x64", format: "AppImage", extension: ".AppImage", note: "Portable, most distributions" },
  { platform: "linux", arch: "arm64", format: "AppImage", extension: ".AppImage", note: "Portable, ARM Linux" },
  { platform: "linux", arch: "x64", format: "Debian package", extension: ".deb", note: "Debian, Ubuntu, and Mint" },
  { platform: "linux", arch: "arm64", format: "Debian package", extension: ".deb", note: "Debian and Ubuntu on ARM" },
  { platform: "linux", arch: "x64", format: "RPM package", extension: ".rpm", note: "Fedora, RHEL, and openSUSE" },
  { platform: "linux", arch: "arm64", format: "RPM package", extension: ".rpm", note: "RPM-based ARM systems" },
  { platform: "linux", arch: "x64", format: "Arch package", extension: ".pacman", note: "Arch Linux and Manjaro" },
  { platform: "linux", arch: "arm64", format: "Arch package", extension: ".pacman", note: "Arch Linux ARM" },
];

function formatSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function assetMatches(asset: ReleaseAsset, build: Build): boolean {
  const name = asset.name.toLowerCase();
  const extension = build.extension.toLowerCase();
  const platformMatches = build.platform === "windows" ? name.includes("win") : name.includes("linux");
  const archMatches =
    build.arch === "x64"
      ? /(?:^|[-_.])(x64|amd64|x86_64)(?:[-_.]|$)/.test(name)
      : /(?:^|[-_.])(arm64|aarch64)(?:[-_.]|$)/.test(name);
  const extensionMatches =
    extension === ".pacman"
      ? name.endsWith(".pacman") || name.endsWith(".pkg.tar.zst")
      : name.endsWith(extension);

  return platformMatches && archMatches && extensionMatches;
}

function detectBuild(): Pick<Build, "platform" | "arch"> | undefined {
  const agent = navigator.userAgent.toLowerCase();
  const platform = agent.includes("windows") ? "windows" : agent.includes("linux") ? "linux" : undefined;
  if (!platform) return undefined;

  return {
    platform,
    arch: /arm64|aarch64/.test(agent) ? "arm64" : "x64",
  };
}

export function DownloadClient({
  apiUrl,
}: {
  apiUrl: string;
}) {
  const [release, setRelease] = useState<Release>();
  const [recommended, setRecommended] = useState<Pick<Build, "platform" | "arch">>();
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");

  useEffect(() => {
    setRecommended(detectBuild());

    const controller = new AbortController();
    fetch(apiUrl, {
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
        return response.json() as Promise<Release>;
      })
      .then((value) => {
        setRelease(value);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setStatus("unavailable");
      });

    return () => controller.abort();
  }, [apiUrl]);

  const checksum = useMemo(
    () => release?.assets.find((asset) => asset.name.toLowerCase() === "sha256sums.txt"),
    [release],
  );

  return (
    <>
      <section className="download-release-bar" aria-live="polite">
        <div>
          <span className={`download-status download-status-${status}`} />
          {status === "ready" && release ? (
            <p><strong>{release.tag_name}</strong> <span>Latest stable release</span></p>
          ) : status === "loading" ? (
            <p><strong>Checking releases</strong> <span>Finding the latest stable build</span></p>
          ) : (
            <p><strong>Downloads temporarily unavailable</strong> <span>Please try again shortly</span></p>
          )}
        </div>
        <div className="download-release-links">
          {release?.published_at && (
            <span>{new Date(release.published_at).toLocaleDateString(undefined, { dateStyle: "medium" })}</span>
          )}
          {checksum && <a href={checksum.browser_download_url}>SHA-256 checksums</a>}
        </div>
      </section>

      {(["windows", "linux"] as const).map((platform) => (
        <section className="download-platform" key={platform} aria-labelledby={`${platform}-downloads`}>
          <header>
            <div className="download-platform-mark" aria-hidden="true">{platform === "windows" ? "W" : "L"}</div>
            <div>
              <h2 id={`${platform}-downloads`}>{platform === "windows" ? "Windows" : "Linux"}</h2>
              <p>
                {platform === "windows"
                  ? "Install Truss for your Windows architecture."
                  : "Choose the package format used by your distribution."}
              </p>
            </div>
          </header>
          <div className="download-build-list">
            {builds.filter((build) => build.platform === platform).map((build) => {
              const asset = release?.assets.find((candidate) => assetMatches(candidate, build));
              const isRecommended =
                recommended?.platform === build.platform &&
                recommended.arch === build.arch &&
                (build.platform === "windows" || build.extension === ".AppImage");

              return (
                <article className="download-build" key={`${build.platform}-${build.extension}-${build.arch}`}>
                  <div className="download-build-copy">
                    <div>
                      <h3>{build.format}</h3>
                      {isRecommended && <span className="download-recommended">Recommended</span>}
                    </div>
                    <p>{build.note}</p>
                  </div>
                  <div className="download-build-meta">
                    <span>{build.arch === "x64" ? "x64 / AMD64" : "ARM64"}</span>
                    <span>{asset ? formatSize(asset.size) : build.extension}</span>
                  </div>
                  {asset ? (
                    <a className="site-button site-button-primary" href={asset.browser_download_url}>
                      Download
                    </a>
                  ) : (
                    <span className="site-button download-button-unavailable" aria-disabled="true">
                      Not available
                    </span>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}
