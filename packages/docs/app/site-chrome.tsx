import Link from "next/link";
import { brand } from "@truss-harness/branding";
import { ThemeToggle } from "./theme-toggle";

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
          <Link href="/truss-go">Truss Go</Link>
          <Link href="/clients">Clients</Link>
          <Link href="/features">Features</Link>
          <Link href="/about">About</Link>
          <Link href="/docs">Docs</Link>
          <Link className="site-nav-download" href="/download">
            Download
          </Link>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-brand">
        <strong>{brand.productName}</strong>
        <p>
          Truss is a local-first, modular runtime for coding agents. Use the
          same tools, safety controls, and workspace state from your terminal,
          VS Code, or a dedicated desktop workspace.
        </p>
      </div>
      <div className="site-footer-links">
        <nav aria-label="Product links">
          <Link href="/download">Download</Link>
          <Link href="/truss-go">Truss Go</Link>
          <Link href="/clients">Clients</Link>
          <Link href="/features">Features</Link>
          <Link href="/roadmap">Roadmap</Link>
          <Link href="/changelog">Changelog</Link>
          <Link href="/docs">Documentation</Link>
        </nav>
        <nav aria-label="Community links">
          <a href={brand.repositoryUrl} target="_blank" rel="noreferrer">GitHub</a>
          <a href="https://www.linkedin.com/company/truss-agent" target="_blank" rel="noreferrer">LinkedIn</a>
        </nav>
      </div>
    </footer>
  );
}
