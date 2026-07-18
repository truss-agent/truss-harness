import Link from "next/link";
import { brand } from "@truss-harness/branding";
import { SiteFooter, SiteHeader } from "../site-chrome";

const features = [
  ["Local model control", "Discover local servers and models, select an endpoint, and keep provider configuration in workspace-aware profiles."],
  ["Native tool execution", "Read, write, search, grep, and run terminal commands through a typed registry and explicit approval flow."],
  ["Three focused clients", "Use command-line automation, a full-screen terminal workspace, or a VS Code side panel without changing the runtime."],
  ["Durable workspace state", "Record repository progress, Git state, task summaries, and handoff notes so new sessions have meaningful context."],
  ["Streaming agent loop", "Receive model tokens, tool requests, approvals, and interruptions as runtime events that every client can render."],
  ["Replaceable foundations", "Providers, tools, context sources, session storage, and clients are defined behind focused TypeScript interfaces."]
] as const;

export const metadata = {
  title: `Features | ${brand.productName}`,
  description: `Local-model, tool-execution, and client capabilities in ${brand.productName}.`
};

export default function FeaturesPage() {
  return <div className="site"><SiteHeader /><main className="site-page"><header className="site-page-intro"><p className="site-eyebrow">Capabilities</p><h1>Designed for the local-model workflow.</h1><p>Truss keeps the agent runtime independent from its interfaces, so each client is useful without carrying the implementation burden of the others.</p></header><section className="site-feature-grid">{features.map(([title, description], index) => <article key={title} className="site-feature"><span>{String(index + 1).padStart(2, "0")}</span><h2>{title}</h2><p>{description}</p></article>)}</section><section className="site-callout"><div><p className="site-eyebrow">Implementation details</p><h2>See the interfaces, configuration, and local setup.</h2></div><Link className="site-button site-button-primary" href="/docs">Open documentation</Link></section></main><SiteFooter /></div>;
}
