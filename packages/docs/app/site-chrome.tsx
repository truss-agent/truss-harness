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
            <img src="/brand-logo.png" width={38} height={38} alt="" />
            <span>{brand.productName}</span>
          </Link>
          <a className="site-open-source" href={brand.repositoryUrl} target="_blank" rel="noreferrer">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path fill="currentColor" d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.16.08 1.78 1.2 1.78 1.2 1.04 1.77 2.72 1.26 3.38.96.1-.75.4-1.26.74-1.55-2.57-.29-5.27-1.28-5.27-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.47.11-3.05 0 0 .97-.31 3.16 1.18a10.9 10.9 0 0 1 5.75 0c2.19-1.49 3.15-1.18 3.15-1.18.63 1.58.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.71 5.38-5.29 5.67.42.36.79 1.06.79 2.14v3.16c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z" />
            </svg>
            Open source
          </a>
        </div>
        <nav className="site-nav" aria-label="Primary navigation">
          <Link href="/about">About</Link>
          <Link href="/features">Features</Link>
          <Link href="/clients">Clients</Link>
          <Link href="/changelog">Changelog</Link>
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
