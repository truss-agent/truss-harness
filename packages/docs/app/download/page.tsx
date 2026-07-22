import Link from "next/link";
import Image from "next/image";
import { brand } from "@truss-harness/branding";
import { SiteFooter, SiteHeader } from "../site-chrome";
import { createPageMetadata } from "../site-metadata";
import { DownloadClient } from "./download-client";

export const metadata = createPageMetadata({ title: "Download", description: `Download ${brand.productName} Desktop for Windows or Linux.`, path: "/download" });

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
        <section className="download-hero">
          <header className="site-page-intro download-intro">
            <p className="site-eyebrow">Truss Desktop</p>
            <h1>Download your local coding workspace.</h1>
            <p>
              Run Truss with Ollama, LM Studio, llama.cpp, or another compatible
              local endpoint. No cloud account is required.
            </p>
          </header>
          <figure className="download-hero-screenshot">
            <Image
              src="/screenshots/desktop.png"
              alt="Truss Desktop workspace showing an agent conversation, files, and tool activity"
              width={1600}
              height={900}
              priority
              sizes="(max-width: 1200px) calc(100vw - 36px), 44vw"
            />
          </figure>
        </section>

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

        <section className="download-android">
          <div>
            <p className="site-eyebrow">Android companion</p>
            <h2>Keep your Truss workspace within reach.</h2>
            <p>
              Pair Truss Go with Truss Desktop or VS Code over your trusted
              Wi-Fi network, then continue the conversation from your Android
              phone without moving provider credentials to the device.
            </p>
          </div>
          <Link className="site-button site-button-secondary" href="/truss-go">
            Explore Truss Go
          </Link>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
