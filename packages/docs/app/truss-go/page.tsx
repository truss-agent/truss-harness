import Link from "next/link";
import { brand } from "@truss-harness/branding";
import { SiteFooter, SiteHeader } from "../site-chrome";
import { createPageMetadata } from "../site-metadata";
import { TrussGoDownloadClient } from "./truss-go-download-client";

export const metadata = createPageMetadata({
  title: "Truss Go",
  description: "Use Truss Go to pair your Android phone with Truss Desktop or VS Code on the same Wi-Fi network.",
  path: "/truss-go"
});

function getRepository(repositoryUrl: string) {
  return repositoryUrl.replace(/^https:\/\/github\.com\//, "").replace(/\/$/, "");
}

export default function TrussGoPage() {
  const repository = getRepository(brand.repositoryUrl);
  const releasesUrl = `${brand.repositoryUrl}/releases`;
  const apiUrl = `https://api.github.com/repos/${repository}/releases?per_page=30`;

  return (
    <div className="site">
      <SiteHeader />
      <main className="truss-go-page">
        <section className="truss-go-hero">
          <div>
            <p className="site-eyebrow">Truss Go for Android</p>
            <h1>Your Truss workspace, in your pocket.</h1>
            <p>Start a trusted pairing from Truss Desktop or VS Code, scan its QR code, and keep working with the agent from your Android phone on the same Wi-Fi network.</p>
            <div className="site-actions">
              <TrussGoDownloadClient apiUrl={apiUrl} releasesUrl={releasesUrl} />
              <Link className="site-button site-button-secondary" href="/docs/clients/truss-go">Read setup guide</Link>
            </div>
          </div>
          <div className="truss-go-pairing" aria-label="Desktop to phone pairing flow">
            <div className="truss-go-desktop"><span>TRUSS</span><strong>Connect Truss Go</strong><i>QR pairing ready</i></div>
            <div className="truss-go-connector" aria-hidden="true">→</div>
            <div className="truss-go-phone"><span>TRUSS GO</span><strong>Connected</strong><i>Workspace chat</i></div>
          </div>
        </section>

        <section className="truss-go-steps">
          <header><p className="site-eyebrow">How it works</p><h2>Three steps. No IP address or token to type.</h2></header>
          <ol>
            <li><span>01</span><h3>Open your workspace</h3><p>Open the workspace you already trust in Truss Desktop or the Truss VS Code extension.</p></li>
            <li><span>02</span><h3>Choose Connect Truss Go</h3><p>Truss opens a temporary same-Wi-Fi connection and displays a pairing QR code.</p></li>
            <li><span>03</span><h3>Scan and work</h3><p>Scan with Truss Go. Use Chat, Plan, or Edit and the approval policy selected on your computer.</p></li>
          </ol>
        </section>

        <section className="truss-go-distribution">
          <div><p className="site-eyebrow">Download options</p><h2>Choose the distribution that fits you.</h2><p>Google Play is the normal installation path. GitHub APKs are useful for testers and early access before the Play listing is available.</p></div>
          <div className="truss-go-distribution-cards">
            <article><span>Google Play</span><h3>Public release</h3><p>Coming soon. This will be the recommended option for everyday Android users.</p><span className="site-button download-button-unavailable" aria-disabled="true">Coming soon</span></article>
            <article><span>GitHub Releases</span><h3>Direct APK</h3><p>Install the signed APK manually. Android will ask you to allow installs from the browser or file manager you use.</p><TrussGoDownloadClient apiUrl={apiUrl} releasesUrl={releasesUrl} /></article>
          </div>
        </section>

        <section className="truss-go-safety"><p className="site-eyebrow">Designed for your network</p><h2>Your phone connects to the computer where Truss is already open.</h2><p>The connection is started explicitly with <strong>Connect Truss Go</strong>, stays on your local network, and ends when you close the pairing panel. The phone does not receive your model-provider credentials or independent access to the workspace.</p></section>
      </main>
      <SiteFooter />
    </div>
  );
}
