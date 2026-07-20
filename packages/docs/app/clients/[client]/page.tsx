import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "../../site-chrome";
import { createPageMetadata } from "../../site-metadata";
import { clientIds, getClientContent } from "../client-content";

type PageProps = { readonly params: Promise<{ readonly client: string }> };

export function generateStaticParams() {
  return clientIds.map((client) => ({ client }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { client: id } = await params;
  const client = getClientContent(id);
  if (!client) return {};
  return createPageMetadata({ title: client.eyebrow, description: client.description, path: `/clients/${client.id}`, image: `/clients/${client.id}/opengraph-image` });
}

export default async function ClientPage({ params }: PageProps) {
  const { client: id } = await params;
  const client = getClientContent(id);
  if (!client) notFound();

  return <div className="site"><SiteHeader /><main className={`client-page client-page-${client.id}`}><section className="client-hero"><div className="client-hero-copy"><p className="site-eyebrow">{client.eyebrow}</p><h1>{client.title}</h1><p>{client.description}</p><div className="site-actions">{client.primaryAction.external ? <a className="site-button site-button-primary" href={client.primaryAction.href} target="_blank" rel="noreferrer">{client.primaryAction.label}</a> : <Link className="site-button site-button-primary" href={client.primaryAction.href}>{client.primaryAction.label}</Link>}<Link className="site-button site-button-secondary" href={client.docsHref}>Read documentation</Link></div></div><figure className="client-screenshot"><Image src={client.screenshotSrc} alt={client.screenshotAlt} width={1600} height={900} priority sizes="(max-width: 760px) calc(100vw - 36px), 50vw" /><figcaption>{client.eyebrow} in action</figcaption></figure></section><section className="client-highlights"><header><p className="site-eyebrow">What it is for</p><h2>Purpose-built for this way of working.</h2></header><div>{client.highlights.map((highlight, index) => <article key={highlight.title}><span>{String(index + 1).padStart(2, "0")}</span><h3>{highlight.title}</h3><p>{highlight.description}</p></article>)}</div></section><section className="client-setup"><div className="client-setup-copy"><p className="site-eyebrow">Get started</p><h2>{client.installLabel}</h2><p>{client.installDescription}</p></div><div className="client-setup-panel">{client.commands ? <pre aria-label={`${client.eyebrow} installation commands`}><code>{client.commands.map((command) => `$ ${command}`).join("\n")}</code></pre> : <ol>{client.workflow.map((step) => <li key={step}>{step}</li>)}</ol>}<div className="client-setup-actions">{client.primaryAction.external ? <a className="site-text-link" href={client.primaryAction.href} target="_blank" rel="noreferrer">{client.primaryAction.label}</a> : <Link className="site-text-link" href={client.primaryAction.href}>{client.primaryAction.label}</Link>}<Link className="site-text-link" href={client.docsHref}>Complete documentation</Link></div></div></section><section className="client-workflow"><p className="site-eyebrow">A typical flow</p><ol>{client.workflow.map((step, index) => <li key={step}><span>{String(index + 1).padStart(2, "0")}</span><p>{step}</p></li>)}</ol></section></main><SiteFooter /></div>;
}
