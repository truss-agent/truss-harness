import Link from "next/link";
import { brand } from "@truss-harness/branding";
import { ThemeToggle } from "./theme-toggle";
import { MobileMenu } from "./mobile-menu";

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <div className="site-brand-group">
          <Link className="site-brand" href="/">
            <img src="/brand-logo.png" width={30} height={30} alt="" />
            <span>{brand.productName}</span>
          </Link>
          <a className="site-open-source" href={brand.repositoryUrl} target="_blank" rel="noreferrer">
            Open source
          </a>
        </div>
        <nav className="site-nav" aria-label="Primary navigation">
          <Link href="/about">About</Link>
          <Link href="/features">Features</Link>
          <Link href="/clients">Clients</Link>
          <Link href="/truss-go">Truss Go</Link>
          <Link href="/docs">Docs</Link>
          <Link className="site-nav-download" href="/download">
            Download
          </Link>
          <ThemeToggle />
        </nav>
        <MobileMenu />
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-main">
        <div className="site-footer-brand">
          <Link className="site-footer-title" href="/">
            <img src="/brand-logo.png" width={30} height={30} alt="" />
            <strong>{brand.productName}</strong>
          </Link>
          <span className="site-footer-kicker">Local-first agent infrastructure</span>
          <p>One modular runtime for coding agents, wherever you do your best work.</p>
        </div>
        <div className="site-footer-links">
          <span className="site-footer-label">Explore</span>
          <nav aria-label="Product links">
            <Link href="/download">Download</Link>
            <Link href="/truss-go">Truss Go</Link>
            <Link href="/clients">Clients</Link>
            <Link href="/features">Features</Link>
            <Link href="/roadmap">Roadmap</Link>
            <Link href="/changelog">Changelog</Link>
            <Link href="/docs">Documentation</Link>
          </nav>
        </div>
        <div className="site-footer-connect">
          <span className="site-footer-label">Stay connected</span>
          <p>Follow the project and see what ships next.</p>
          <div className="site-footer-socials">
            <a href={brand.repositoryUrl} target="_blank" rel="noreferrer">GitHub <span aria-hidden="true">↗</span></a>
            <a href="https://www.linkedin.com/company/truss-agent" target="_blank" rel="noreferrer">LinkedIn <span aria-hidden="true">↗</span></a>
          </div>
        </div>
      </div>
      <div className="site-footer-bottom">
        <span>Built for thoughtful software work.</span>
        <span>© {new Date().getFullYear()} {brand.productName}</span>
      </div>
    </footer>
  );
}
