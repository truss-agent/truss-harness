import Link from "next/link";
import { SiteFooter, SiteHeader } from "../site-chrome";
import { createPageMetadata } from "../site-metadata";

const entries = [
  {
    version: "Unreleased",
    label: "Recently completed",
    changes: [
      "Added Truss Go for Android, with signed APK releases, setup guidance, and a dedicated product page.",
      "Added trusted same-Wi-Fi QR pairing from Truss Desktop and VS Code so Truss Go can continue a workspace conversation without receiving model-provider credentials.",
      "Stabilized Truss Go pairing with physical LAN-adapter detection, a persistent Desktop gateway, reconnect diagnostics, selectable approval policies, and an Android-safe adaptive icon.",
      "Added MCP stdio tool discovery and invocation across the shared runtime, with connection diagnostics, approval policies, and explicit trust for workspace-defined servers.",
      "Shipped dedicated pages for the CLI, terminal UI, VS Code extension, desktop app, and Truss Go, plus a clearer responsive website and download experience.",
      "Improved desktop request context with the active editor and other open tabs while keeping explicitly attached files at the highest priority."
    ]
  },
  {
    version: "0.1.0",
    label: "Initial public release",
    changes: [
      "Released the shared local-first runtime with provider-neutral tools, persistent workspace state, plans, memory, and approval controls.",
      "Shipped four ways to work: CLI automation, a full-screen terminal UI, a VS Code extension, and the standalone desktop workspace.",
      "Added local-model discovery for Ollama, LM Studio, llama.cpp, and compatible endpoints, plus Git-aware tools and streaming agent events."
    ]
  }
] as const;

export const metadata = createPageMetadata({
  title: "Changelog",
  description: "Product updates for Truss, including its shared runtime, desktop and editor clients, terminal tools, and Truss Go for Android.",
  path: "/changelog"
});

export default function ChangelogPage() {
  return (
    <div className="site">
      <SiteHeader />
      <main className="site-page changelog-page">
        <header className="site-page-intro">
          <p className="site-eyebrow">Changelog</p>
          <h1>What&apos;s new in Truss.</h1>
          <p>
            Follow the runtime, clients, and integrations as they ship. Each
            update moves Truss toward one consistent agent experience across
            your computer, editor, terminal, and phone.
          </p>
        </header>

        <section className="changelog-list" aria-label="Product updates">
          {entries.map((entry) => (
            <article key={entry.version}>
              <header>
                <span>{entry.version}</span>
                <p>{entry.label}</p>
              </header>
              <ul>
                {entry.changes.map((change) => <li key={change}>{change}</li>)}
              </ul>
            </article>
          ))}
        </section>

        <section className="site-callout">
          <div>
            <p className="site-eyebrow">Available now</p>
            <h2>Try the latest Truss clients.</h2>
          </div>
          <Link className="site-button site-button-primary" href="/download">View downloads</Link>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
