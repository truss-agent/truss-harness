import Link from "next/link";
import { brand } from "@truss-harness/branding";
import { SiteFooter, SiteHeader } from "../site-chrome";
import { DownloadClient } from "./download-client";

export const metadata = {
  title: "Download",
  description: `Download ${brand.productName} Desktop for Windows or Linux.`,
};

function getReleaseApiUrl(repositoryUrl: string) {
  const repository = repositoryUrl.replace(/^https:\/\/github\.com\//, "").replace(/\/$/, "");
  return `https://api.github.com/repos/${repository}/releases/latest`;
}

export default function DownloadPage() {
  const apiUrl = getReleaseApiUrl(brand.repositoryUrl);

  return (
    <div className="site">
      <SiteHeader />
      <main className="site-page download-page">
        <header className="site-page-intro download-intro">
          <p className="site-eyebrow">Truss Desktop</p>
          <h1>Download your local coding workspace.</h1>
          <p>
            Run Truss with Ollama, LM Studio, llama.cpp, or another compatible
            local endpoint. No cloud account is required.
          </p>
        </header>

        <DownloadClient apiUrl={apiUrl} />

        <section className="download-help">
          <div>
            <p className="site-eyebrow">Other clients</p>
            <h2>Prefer the terminal or VS Code?</h2>
            <p>The CLI and TUI install through npm. The VS Code extension installs from the Marketplace or a VSIX.</p>
          </div>
          <div className="site-card-links">
            <a className="site-text-link" href="https://marketplace.visualstudio.com/items?itemName=truss-harness.truss-harness-vscode" target="_blank" rel="noreferrer">
              Get VS Code extension
            </a>
            <Link className="site-text-link" href="/docs/getting-started">
              View installation guide
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
