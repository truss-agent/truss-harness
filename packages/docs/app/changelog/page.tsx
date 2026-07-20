import Link from "next/link";
import { SiteFooter, SiteHeader } from "../site-chrome";
import { createPageMetadata } from "../site-metadata";

const entries = [
  {
    version: "Unreleased",
    label: "What is landing next",
    changes: [
      "Dedicated client pages for the CLI, terminal UI, VS Code extension, and desktop app, each with an in-product screenshot, setup path, and documentation link.",
      "A refined landing page with optional light and dark themes, a scroll-initiated terminal session, and clearer client navigation.",
      "Desktop chat now includes the active editor plus other open tabs as bounded request context, while preserving explicit file attachments as the higher-priority context."
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

export const metadata = createPageMetadata({ title: "Changelog", description: "Product updates for Truss: the local-first coding-agent runtime and its CLI, terminal, VS Code, and desktop clients.", path: "/changelog" });

export default function ChangelogPage() {
  return <div className="site"><SiteHeader /><main className="site-page changelog-page"><header className="site-page-intro"><p className="site-eyebrow">Changelog</p><h1>What’s new in Truss.</h1><p>Follow the evolution of the shared runtime and the clients built on it. For implementation detail, browse the documentation or the project on GitHub.</p></header><section className="changelog-list" aria-label="Product updates">{entries.map((entry) => <article key={entry.version}><header><span>{entry.version}</span><p>{entry.label}</p></header><ul>{entry.changes.map((change) => <li key={change}>{change}</li>)}</ul></article>)}</section><section className="site-callout"><div><p className="site-eyebrow">Stay close</p><h2>Follow the work as it ships.</h2></div><Link className="site-button site-button-primary" href="/download">Download desktop</Link></section></main><SiteFooter /></div>;
}
