import { getReleases } from "./server-releases";
import { brand } from "@truss-harness/branding";
import { SiteFooter, SiteHeader } from "../site-chrome";
import { createPageMetadata } from "../site-metadata";
import { DownloadClient } from "./download-client";

export const metadata = createPageMetadata({
  title: "Download",
  description: `Install ${brand.productName} Desktop, VS Code, CLI, TUI, Neovim, or Truss Go for Android.`,
  path: "/download",
});

export const revalidate = 3600;

export default async function DownloadPage() {
  const releases = await getReleases();

  return (
    <div className="site">
      <SiteHeader />
      <main className="site-page download-page">
        <DownloadClient
          releases={releases}
          releasesUrl={`${brand.repositoryUrl}/releases`}
        />
      </main>
      <SiteFooter />
    </div>
  );
}
