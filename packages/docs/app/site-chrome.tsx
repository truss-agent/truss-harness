import Link from "next/link";
import { brand } from "@truss-harness/branding";

export function SiteHeader() {
  return <header className="site-header"><div className="site-header-inner"><Link className="site-brand" href="/"><img src="/brand-logo.png" width={30} height={30} alt="" /><span>{brand.productName}</span></Link><nav className="site-nav" aria-label="Primary navigation"><Link href="/features">Features</Link><Link href="/about">About</Link><Link className="site-nav-docs" href="/docs">Docs</Link></nav></div></header>;
}

export function SiteFooter() {
  return <footer className="site-footer"><div><strong>{brand.productName}</strong><span>Local-first coding agents</span></div><nav aria-label="Footer navigation"><Link href="/features">Features</Link><Link href="/about">About</Link><Link href="/docs">Documentation</Link></nav></footer>;
}
