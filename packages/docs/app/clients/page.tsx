import Link from "next/link";
import { SiteFooter, SiteHeader } from "../site-chrome";
import { createPageMetadata } from "../site-metadata";
import { clientIds, clientContent } from "./client-content";

export const metadata = createPageMetadata({
  title: "Clients",
  description: "Choose the Truss client that fits your workflow: CLI, terminal UI, VS Code extension, or desktop app.",
  path: "/clients"
});

export default function ClientsPage() {
  return <div className="site"><SiteHeader /><main className="site-page clients-index"><header className="site-page-intro"><p className="site-eyebrow">Client surfaces</p><h1>One runtime. The interface you want.</h1><p>Every Truss client works with the same local-model configuration, tools, permission policies, workspace memory, and implementation plans.</p></header><section className="clients-index-grid">{clientIds.map((id) => { const client = clientContent[id]; return <article key={id}><span>{client.eyebrow}</span><h2>{client.title}</h2><p>{client.description}</p><Link className="site-button site-button-secondary" href={`/clients/${id}`}>Explore {client.eyebrow}</Link></article>; })}</section></main><SiteFooter /></div>;
}
