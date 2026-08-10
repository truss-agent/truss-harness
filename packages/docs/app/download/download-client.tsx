"use client";

import { useEffect, useMemo, useState } from "react";
import {
  selectDesktopRelease,
  selectNeovimRelease,
  selectTrussGoRelease,
  selectVscodeRelease,
} from "./release-selection";

type ReleaseAsset = {
  browser_download_url: string;
  name: string;
  size: number;
};

type Release = {
  assets: ReleaseAsset[];
  draft: boolean;
  prerelease: boolean;
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

function formatSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function assetMatches(asset: ReleaseAsset, build: Build): boolean {
  const name = asset.name.toLowerCase();
  const extension = build.extension.toLowerCase();
  const platformMatches =
    build.platform === "windows"
      ? name.includes("win")
      : name.includes("linux");
  const archMatches =
    build.arch === "x64"
      ? /(?:^|[-_.])(x64|amd64|x86_64)(?:[-_.]|$)/.test(name)
      : /(?:^|[-_.])(arm64|aarch64)(?:[-_.]|$)/.test(name);
  const extensionMatches =
    extension === ".pacman"
      ? name.endsWith(".pacman") || name.endsWith(".pkg.tar.zst")
      : extension === ".tar.gz"
        ? name.endsWith(".tar.gz")
        : name.endsWith(extension);

  return platformMatches && archMatches && extensionMatches;
}

function detectBuild(): Pick<Build, "platform" | "arch"> | undefined {
  const agent = navigator.userAgent.toLowerCase();
  const platform = agent.includes("windows")
    ? "windows"
    : agent.includes("linux")
      ? "linux"
      : undefined;
  if (!platform) return undefined;

  return {
    platform,
    arch: /arm64|aarch64/.test(agent) ? "arm64" : "x64",
  };
}

function releaseDate(release: Release | undefined): string | undefined {
  return release?.published_at
    ? new Date(release.published_at).toLocaleDateString(undefined, {
        dateStyle: "medium",
      })
    : undefined;
}

function buildKey(build: Build): string {
  return `${build.platform}:${build.arch}:${build.extension}`;
}

function buildLabel(build: Build): string {
  const architecture = build.arch === "x64" ? "x64 / AMD64" : "ARM64";
  return `${build.format} · ${architecture}`;
}

function platformLabel(build: Pick<Build, "platform" | "arch">): string {
  const platform = build.platform === "windows" ? "Windows" : "Linux";
  const architecture = build.arch === "x64" ? "x64" : "ARM64";
  return `${platform} ${architecture}`;
}

function DesktopReleaseCard({
  release,
  recommended,
  releasesUrl,
}: {
  readonly release: Release | undefined;
  readonly recommended: Pick<Build, "platform" | "arch"> | undefined;
  readonly releasesUrl: string;
}) {
  const [selectedBuildKey, setSelectedBuildKey] = useState<string>();
  const recommendedBuild = builds.find(
    (build) =>
      build.platform === recommended?.platform &&
      build.arch === recommended.arch &&
      (build.platform === "windows" || build.extension === ".tar.gz"),
  );
  const selectedBuild =
    builds.find((build) => buildKey(build) === selectedBuildKey) ??
    recommendedBuild ??
    builds[0];
  const selectedAsset = release?.assets.find((asset) =>
    assetMatches(asset, selectedBuild),
  );
  const published = releaseDate(release);
  const selectedIsRecommended =
    recommendedBuild !== undefined &&
    buildKey(selectedBuild) === buildKey(recommendedBuild);

  return (
    <article className="download-client-card">
      <header>
        <p className="site-eyebrow">Truss Desktop</p>
        <h2>Desktop</h2>
        <p>
          A focused local coding workspace with files, Git, terminal work,
          provider controls, and agent approvals.
        </p>
      </header>
      <div className="download-client-release">
        {release ? (
          <>
            <span
              className="download-status download-status-ready"
              aria-hidden="true"
            />
            <div>
              <strong>{release.tag_name}</strong>
              <span>
                Latest stable release{published ? ` · ${published}` : ""}
              </span>
            </div>
          </>
        ) : (
          <>
            <span
              className="download-status download-status-unavailable"
              aria-hidden="true"
            />
            <div>
              <strong>Release unavailable</strong>
              <span>Check the Desktop releases for current builds.</span>
            </div>
          </>
        )}
      </div>
      <div className="download-client-package">
        <details>
          <summary>
            <span className="download-client-package-choice">
              <span className="download-client-package-label">
                Desktop package
              </span>
              <strong>{buildLabel(selectedBuild)}</strong>
              <small>
                {selectedIsRecommended && recommended
                  ? `Recommended for ${platformLabel(recommended)}`
                  : selectedBuild.note}
              </small>
            </span>
            <span className="download-client-package-change">Change</span>
          </summary>
          <div className="download-client-package-menu">
            {(["windows", "linux"] as const).map((platform) => (
              <section key={platform}>
                <h3>{platform === "windows" ? "Windows" : "Linux"}</h3>
                {builds
                  .filter((build) => build.platform === platform)
                  .map((build) => {
                    const selected =
                      buildKey(build) === buildKey(selectedBuild);
                    const isRecommended =
                      recommendedBuild !== undefined &&
                      buildKey(build) === buildKey(recommendedBuild);
                    return (
                      <button
                        type="button"
                        aria-pressed={selected}
                        className={selected ? "selected" : undefined}
                        key={buildKey(build)}
                        onClick={(event) => {
                          setSelectedBuildKey(buildKey(build));
                          event.currentTarget
                            .closest("details")
                            ?.removeAttribute("open");
                        }}
                      >
                        <span>
                          <strong>{buildLabel(build)}</strong>
                          <small>{build.note}</small>
                        </span>
                        {isRecommended ? <em>Recommended</em> : null}
                      </button>
                    );
                  })}
              </section>
            ))}
          </div>
        </details>
      </div>
      <div className="download-client-actions">
        {selectedAsset ? (
          <a
            className="site-button site-button-primary"
            href={selectedAsset.browser_download_url}
          >
            Download package
          </a>
        ) : (
          <span
            className="site-button download-button-unavailable"
            aria-disabled="true"
          >
            Not available
          </span>
        )}
        <a
          className="site-button site-button-secondary"
          href="/docs/clients/desktop"
        >
          Desktop guide
        </a>
      </div>
      <a
        className="site-text-link download-client-all-releases"
        href={releasesUrl}
        target="_blank"
        rel="noreferrer"
      >
        View Desktop releases
      </a>
    </article>
  );
}

function ReleaseCard({
  eyebrow,
  title,
  description,
  release,
  asset,
  distribution,
  sourceHref,
  sourceLabel,
  detailsHref,
  detailsLabel,
  downloadLabel,
  primaryHref,
  badge,
  additionalAction,
  manualInstall,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly release: Release | undefined;
  readonly asset: ReleaseAsset | undefined;
  readonly distribution?: {
    readonly label: string;
    readonly description: string;
  };
  readonly sourceHref: string;
  readonly sourceLabel: string;
  readonly detailsHref: string;
  readonly detailsLabel: string;
  readonly downloadLabel: string;
  readonly primaryHref?: string;
  readonly badge?: string;
  readonly additionalAction?: {
    readonly href: string;
    readonly label: string;
  };
  readonly manualInstall?: string;
}) {
  const published = releaseDate(release);
  return (
    <article className="download-client-card">
      <header>
        <p className="site-eyebrow">{eyebrow}</p>
        <div className="download-client-title-row">
          <h2>{title}</h2>
          {badge ? (
            <span className="download-client-badge">{badge}</span>
          ) : null}
        </div>
        <p>{description}</p>
      </header>
      <div className="download-client-release">
        {release ? (
          <>
            <span
              className="download-status download-status-ready"
              aria-hidden="true"
            />
            <div>
              <strong>{release.tag_name}</strong>
              <span>
                Latest stable release{published ? ` · ${published}` : ""}
              </span>
            </div>
          </>
        ) : (
          <>
            <span
              className={`download-status download-status-${
                distribution ? "ready" : "unavailable"
              }`}
              aria-hidden="true"
            />
            <div>
              <strong>{distribution?.label ?? "Release unavailable"}</strong>
              <span>
                {distribution?.description ??
                  "Check the distribution source for current builds."}
              </span>
            </div>
          </>
        )}
      </div>
      <div className="download-client-actions">
        {asset || primaryHref ? (
          <a
            className="site-button site-button-primary"
            href={asset?.browser_download_url ?? primaryHref}
          >
            {downloadLabel}
          </a>
        ) : (
          <a
            className="site-button site-button-secondary"
            href={sourceHref}
            target="_blank"
            rel="noreferrer"
          >
            {sourceLabel}
          </a>
        )}
        {additionalAction ? (
          <a
            className="site-button site-button-secondary"
            href={additionalAction.href}
            target="_blank"
            rel="noreferrer"
          >
            {additionalAction.label}
          </a>
        ) : null}
        <a className="site-button site-button-secondary" href={detailsHref}>
          {detailsLabel}
        </a>
      </div>
      {manualInstall ? (
        <p className="download-client-manual-install">{manualInstall}</p>
      ) : null}
      <a
        className="site-text-link download-client-all-releases"
        href={sourceHref}
        target="_blank"
        rel="noreferrer"
      >
        {sourceLabel}
      </a>
    </article>
  );
}

export function DownloadClient({
  apiUrl,
  releasesUrl,
}: {
  apiUrl: string;
  releasesUrl: string;
}) {
  const [release, setRelease] = useState<Release>();
  const [releases, setReleases] = useState<readonly Release[]>([]);
  const [recommended, setRecommended] =
    useState<Pick<Build, "platform" | "arch">>();
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">(
    "loading",
  );

  useEffect(() => {
    setRecommended(detectBuild());

    const controller = new AbortController();
    fetch(apiUrl, {
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
        return response.json() as Promise<Release[]>;
      })
      .then((releases) => {
        const desktopRelease = selectDesktopRelease(releases);
        if (!desktopRelease) throw new Error("No desktop release was found");
        setReleases(releases);
        setRelease(desktopRelease);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setStatus("unavailable");
      });

    return () => controller.abort();
  }, [apiUrl]);

  const checksum = useMemo(
    () =>
      release?.assets.find(
        (asset) => asset.name.toLowerCase() === "sha256sums.txt",
      ),
    [release],
  );
  const androidRelease = useMemo(
    () => selectTrussGoRelease(releases),
    [releases],
  );
  const neovimRelease = useMemo(
    () => selectNeovimRelease(releases),
    [releases],
  );
  const vscodeRelease = useMemo(
    () => selectVscodeRelease(releases),
    [releases],
  );
  const androidApk = useMemo(
    () =>
      androidRelease?.assets.find((asset) =>
        asset.name.toLowerCase().endsWith(".apk"),
      ),
    [androidRelease],
  );
  const neovimArchive = useMemo(
    () =>
      neovimRelease?.assets.find((asset) =>
        asset.name.toLowerCase().endsWith(".tar.gz"),
      ),
    [neovimRelease],
  );

  return (
    <>
      <section className="download-client-section" aria-labelledby="downloads">
        <header>
          <p className="site-eyebrow">Truss downloads</p>
          <h1 id="downloads">Choose the Truss client for your workflow.</h1>
          <p>
            Pick the client that fits your workflow. Every installable Truss
            client has one consistent starting point here.
          </p>
        </header>
        <div className="download-client-grid">
          <DesktopReleaseCard
            release={release}
            recommended={recommended}
            releasesUrl={releasesUrl}
          />
          <ReleaseCard
            eyebrow="Truss for VS Code"
            title="VS Code"
            badge="Beta"
            description="Keep Truss inside your editor with chat, file context, completions, approvals, and a bundled runtime service."
            release={vscodeRelease}
            asset={vscodeRelease?.assets.find((asset) =>
              asset.name.toLowerCase().endsWith(".vsix"),
            )}
            distribution={{
              label: "VS Code release unavailable",
              description: "Check the VS Code releases for the current VSIX.",
            }}
            sourceHref={releasesUrl}
            sourceLabel="View VS Code releases"
            detailsHref="/docs/clients/vscode"
            detailsLabel="VS Code guide"
            downloadLabel="Download VSIX"
            additionalAction={{
              href: "https://marketplace.visualstudio.com/items?itemName=truss-harness.truss-harness-vscode",
              label: "Install from Marketplace",
            }}
            manualInstall="Manual VSIX install: open Extensions, choose the … menu, select Install from VSIX…, then choose the downloaded file."
          />
          <ReleaseCard
            eyebrow="Truss command line"
            title="CLI"
            description="Run focused agent tasks, manage profiles, host the editor service, and keep the runtime in your terminal."
            release={undefined}
            asset={undefined}
            distribution={{
              label: "npm package",
              description: "Install the latest published CLI globally.",
            }}
            sourceHref="https://www.npmjs.com/package/@truss-harness/cli"
            sourceLabel="View CLI on npm"
            detailsHref="/docs/clients/cli"
            detailsLabel="CLI guide"
            downloadLabel="Install CLI"
            primaryHref="https://www.npmjs.com/package/@truss-harness/cli"
          />
          <ReleaseCard
            eyebrow="Truss terminal UI"
            title="TUI"
            description="Use the full-screen terminal workspace when you want conversations, file context, and approvals without leaving the shell."
            release={undefined}
            asset={undefined}
            distribution={{
              label: "npm package",
              description: "Install the latest published terminal UI globally.",
            }}
            sourceHref="https://www.npmjs.com/package/@truss-harness/tui"
            sourceLabel="View TUI on npm"
            detailsHref="/docs/clients/tui"
            detailsLabel="TUI guide"
            downloadLabel="Install TUI"
            primaryHref="https://www.npmjs.com/package/@truss-harness/tui"
          />
          <ReleaseCard
            eyebrow="Truss Go for Android"
            title="Truss Go"
            description="Pair your phone with a trusted Desktop or VS Code workspace and continue the same conversation on your local Wi-Fi."
            release={androidRelease}
            asset={androidApk}
            sourceHref={releasesUrl}
            sourceLabel="View Android releases"
            detailsHref="/truss-go"
            detailsLabel="Android setup"
            downloadLabel="Download Android APK"
          />
          <ReleaseCard
            eyebrow="Truss for Neovim"
            title="truss.nvim"
            badge="Beta"
            description="Bring Chat, Plan, Edit, approvals, and local-model controls into Neovim or LazyVim without moving credentials into Lua."
            release={neovimRelease}
            asset={neovimArchive}
            sourceHref={releasesUrl}
            sourceLabel="View Neovim releases"
            detailsHref="/docs/clients/neovim"
            detailsLabel="Installation guide"
            downloadLabel="Download plugin archive"
          />
        </div>
      </section>

      <section className="download-desktop-section" id="desktop-downloads">
        <header className="download-desktop-section-heading">
          <p className="site-eyebrow">Truss Desktop</p>
          <h2>Choose your Desktop package.</h2>
          <p>
            Windows installers and Linux packages for every supported
            architecture.
          </p>
        </header>
        <section className="download-release-bar" aria-live="polite">
          <div>
            <span className={`download-status download-status-${status}`} />
            {status === "ready" && release ? (
              <p>
                <strong>{release.tag_name}</strong>{" "}
                <span>Latest stable release</span>
              </p>
            ) : status === "loading" ? (
              <p>
                <strong>Checking releases</strong>{" "}
                <span>Finding the latest stable build</span>
              </p>
            ) : (
              <p>
                <strong>Downloads temporarily unavailable</strong>{" "}
                <span>Please try again shortly</span>
              </p>
            )}
          </div>
          <div className="download-release-links">
            {release?.published_at && (
              <span>
                {new Date(release.published_at).toLocaleDateString(undefined, {
                  dateStyle: "medium",
                })}
              </span>
            )}
            {checksum && (
              <a href={checksum.browser_download_url}>SHA-256 checksums</a>
            )}
            <a href={releasesUrl} target="_blank" rel="noreferrer">
              View Desktop releases
            </a>
          </div>
        </section>

        {(["windows", "linux"] as const).map((platform) => (
          <section
            className="download-platform"
            key={platform}
            aria-labelledby={`${platform}-downloads`}
          >
            <header>
              <div className="download-platform-mark" aria-hidden="true">
                {platform === "windows" ? "W" : "L"}
              </div>
              <div>
                <h2 id={`${platform}-downloads`}>
                  {platform === "windows" ? "Windows" : "Linux"}
                </h2>
                <p>
                  {platform === "windows"
                    ? "Install Truss for your Windows architecture."
                    : "Choose the package format used by your distribution."}
                </p>
              </div>
            </header>
            <div className="download-build-list">
              {builds
                .filter((build) => build.platform === platform)
                .map((build) => {
                  const asset = release?.assets.find((candidate) =>
                    assetMatches(candidate, build),
                  );
                  const isRecommended =
                    recommended?.platform === build.platform &&
                    recommended.arch === build.arch &&
                    (build.platform === "windows" ||
                      build.extension === ".AppImage");

                  return (
                    <article
                      className="download-build"
                      key={`${build.platform}-${build.extension}-${build.arch}`}
                    >
                      <div className="download-build-copy">
                        <div>
                          <h3>{build.format}</h3>
                          {isRecommended && (
                            <span className="download-recommended">
                              Recommended
                            </span>
                          )}
                        </div>
                        <p>{build.note}</p>
                      </div>
                      <div className="download-build-meta">
                        <span>
                          {build.arch === "x64" ? "x64 / AMD64" : "ARM64"}
                        </span>
                        <span>
                          {asset ? formatSize(asset.size) : build.extension}
                        </span>
                      </div>
                      {asset ? (
                        <a
                          className="site-button site-button-primary"
                          href={asset.browser_download_url}
                        >
                          Download
                        </a>
                      ) : (
                        <span
                          className="site-button download-button-unavailable"
                          aria-disabled="true"
                        >
                          Not available
                        </span>
                      )}
                    </article>
                  );
                })}
            </div>
          </section>
        ))}
      </section>
    </>
  );
}
