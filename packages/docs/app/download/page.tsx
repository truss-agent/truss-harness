import { brand } from "@truss-harness/branding";
import { SiteFooter, SiteHeader } from "../site-chrome";
import { createPageMetadata } from "../site-metadata";
import { DownloadClient } from "./download-client";

export const metadata = createPageMetadata({
  title: "Download",
  description: `Install ${brand.productName} Desktop, VS Code, CLI, TUI, Neovim, or Truss Go for Android.`,
  path: "/download",
});

function getReleaseApiUrl(repositoryUrl: string) {
  const repository = repositoryUrl
    .replace(/^https:\/\/github\.com\//, "")
    .replace(/\/$/, "");
  return `https://api.github.com/repos/${repository}/releases?per_page=100`;
}

export default function DownloadPage() {
  const apiUrl = getReleaseApiUrl(brand.repositoryUrl);

  return (
    <div className="site">
      <SiteHeader />
      <main className="site-page download-page">
        <DownloadClient
          apiUrl={apiUrl}
          releasesUrl={`${brand.repositoryUrl}/releases`}
        />
      </main>
      <SiteFooter />
    </div>
  );
}
