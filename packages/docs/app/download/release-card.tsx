import {
  releaseDate,
  type Release,
  type ReleaseAsset,
} from "./download-catalog";

export interface ReleaseCardProps {
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
    readonly badge?: string;
  };
  readonly manualInstall?: string;
}

export function ReleaseCard({
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
}: ReleaseCardProps) {
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
              className={`download-status download-status-${distribution ? "ready" : "unavailable"}`}
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
            className={`site-button site-button-secondary${additionalAction.badge ? " download-client-action-with-badge" : ""}`}
            href={additionalAction.href}
            target="_blank"
            rel="noreferrer"
          >
            {additionalAction.label}
            {additionalAction.badge ? (
              <span className="download-client-action-badge">
                {additionalAction.badge}
              </span>
            ) : null}
          </a>
        ) : null}
        <a className="site-button site-button-secondary" href={detailsHref}>
          {detailsLabel}
        </a>
      </div>
      {manualInstall ? (
        <div className="download-client-manual-install">
          <p>{manualInstall}</p>
        </div>
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
