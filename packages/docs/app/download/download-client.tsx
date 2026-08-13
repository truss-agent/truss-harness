"use client";

import { useEffect, useMemo, useState } from "react";
import {
  selectDesktopRelease,
  selectNeovimRelease,
  selectTrussGoRelease,
  selectVscodeRelease,
} from "./release-selection";
import {
  assetMatchesBuild,
  desktopBuildKey,
  desktopBuildLabel,
  desktopBuilds,
  detectDesktopBuild,
  detectedBuildLabel,
  formatAssetSize,
  recommendedDesktopBuild,
  releaseDate,
  type DesktopBuild,
  type DetectedBuild,
  type Release,
} from "./download-catalog";
import { ReleaseCard } from "./release-card";

function DesktopReleaseCard({
  release,
  recommended,
  releasesUrl,
}: {
  readonly release: Release | undefined;
  readonly recommended: DetectedBuild | undefined;
  readonly releasesUrl: string;
}) {
  const [selectedBuildKey, setSelectedBuildKey] = useState<string>();
  const recommendedBuild = recommendedDesktopBuild(recommended);
  const selectedBuild =
    desktopBuilds.find(
      (build) => desktopBuildKey(build) === selectedBuildKey,
    ) ??
    recommendedBuild ??
    desktopBuilds[0];
  const selectedAsset = release?.assets.find((asset) =>
    assetMatchesBuild(asset, selectedBuild),
  );
  const published = releaseDate(release);
  const selectedIsRecommended =
    recommendedBuild !== undefined &&
    desktopBuildKey(selectedBuild) === desktopBuildKey(recommendedBuild);

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
              <strong>{desktopBuildLabel(selectedBuild)}</strong>
              <small>
                {selectedIsRecommended && recommended
                  ? `Recommended for ${detectedBuildLabel(recommended)}`
                  : selectedBuild.note}
              </small>
            </span>
            <span className="download-client-package-change">Change</span>
          </summary>
          <div className="download-client-package-menu">
            {(["windows", "linux"] as const).map((platform) => (
              <section key={platform}>
                <h3>{platform === "windows" ? "Windows" : "Linux"}</h3>
                {desktopBuilds
                  .filter((build) => build.platform === platform)
                  .map((build) => {
                    const selected =
                      desktopBuildKey(build) === desktopBuildKey(selectedBuild);
                    const isRecommended =
                      recommendedBuild !== undefined &&
                      desktopBuildKey(build) ===
                        desktopBuildKey(recommendedBuild);
                    return (
                      <button
                        type="button"
                        aria-pressed={selected}
                        className={selected ? "selected" : undefined}
                        key={desktopBuildKey(build)}
                        onClick={(event) => {
                          setSelectedBuildKey(desktopBuildKey(build));
                          event.currentTarget
                            .closest("details")
                            ?.removeAttribute("open");
                        }}
                      >
                        <span>
                          <strong>{desktopBuildLabel(build)}</strong>
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

export function DownloadClient({
  apiUrl,
  releasesUrl,
}: {
  apiUrl: string;
  releasesUrl: string;
}) {
  const [release, setRelease] = useState<Release>();
  const [releases, setReleases] = useState<readonly Release[]>([]);
  const [recommended, setRecommended] = useState<DetectedBuild>();
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">(
    "loading",
  );

  useEffect(() => {
    setRecommended(detectDesktopBuild(navigator.userAgent));

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
              {desktopBuilds
                .filter((build) => build.platform === platform)
                .map((build) => {
                  const asset = release?.assets.find((candidate) =>
                    assetMatchesBuild(candidate, build),
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
                          {asset
                            ? formatAssetSize(asset.size)
                            : build.extension}
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
