import Link from "next/link";
import { brand } from "@truss-harness/branding";
import { SiteFooter, SiteHeader } from "../site-chrome";

export const metadata = {
  title: `About | ${brand.productName}`,
  description: `Why ${brand.productName} is a local-first, modular coding-agent runtime.`
};

export default function AboutPage() {
  return <div className="site"><SiteHeader /><main className="site-page"><header className="site-page-intro"><p className="site-eyebrow">About {brand.productName}</p><h1>A runtime before an interface.</h1><p>{brand.productName} is a modular harness for coding agents. The CLI, terminal UI, VS Code extension, and standalone desktop app are clients of the same runtime—not separate implementations.</p></header><section className="site-about-grid"><div><p className="site-eyebrow">The approach</p><h2>Local models need a disciplined environment.</h2></div><div className="site-about-copy"><p>Truss favors direct context, native tool calling, bounded workspace state, and clear permission boundaries. That gives locally hosted models a practical environment without requiring an oversized prompt or a provider-specific workflow.</p><p>The runtime is TypeScript-first and event-driven. Providers, tools, session storage, memory, context selection, plans, and clients remain replaceable so the platform can grow without coupling its core to one editor, client, or model host.</p></div></section><section className="site-principles"><article><span>Local</span><h3>Own the execution</h3><p>Run against your chosen server and workspace with no required cloud control plane.</p></article><article><span>Modular</span><h3>Change a subsystem</h3><p>Add a provider, tool, or client without rebuilding the runtime around it.</p></article><article><span>Practical</span><h3>Keep momentum</h3><p>Persist useful state, request approvals deliberately, and resume work with context.</p></article></section><section className="site-callout"><div><p className="site-eyebrow">Get started</p><h2>Run Truss against a local model.</h2></div><Link className="site-button site-button-primary" href="/docs/getting-started">Get started</Link></section></main><SiteFooter /></div>;
}
