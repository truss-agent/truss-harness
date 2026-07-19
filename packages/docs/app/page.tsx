import Link from "next/link";
import { brand } from "@truss-harness/branding";
import { SiteFooter, SiteHeader } from "./site-chrome";
import { createPageMetadata } from "./site-metadata";

export const metadata = createPageMetadata({ title: brand.productName, description: "A modular, local-first coding-agent runtime for CLI, terminal, VS Code, and desktop workflows.", path: "/" });

export default function HomePage() {
  return (
    <div className="site">
      <SiteHeader />
      <main>
        <section className="site-hero">
          <div className="site-hero-copy">
            <p className="site-eyebrow">Local-first coding agents</p>
            <h1>{brand.productName}</h1>
            <p className="site-lede">
              A modular coding-agent runtime for local models with a CLI,
              full-screen TUI, VS Code extension, and desktop app built on the
              same tools, safeguards, and workspace state.
            </p>
            <div className="site-actions">
              <Link
                className="site-button site-button-primary"
                href="/download"
              >
                Download desktop
              </Link>
              <Link
                className="site-button site-button-secondary"
                href="/docs/getting-started"
              >
                Get started
              </Link>
              <Link
                className="site-button site-button-secondary"
                href="/features"
              >
                Explore features
              </Link>
            </div>
          </div>
          <div className="site-terminal" aria-label="Truss CLI preview">
            <div className="site-terminal-bar">
              <span>truss-harness CLI</span>
              <span>local workspace</span>
            </div>
            <div className="site-terminal-body">
              <p>
                <b>$</b> truss-harness chat "Review the current diff"
              </p>
              <p className="site-terminal-muted">
                model: qwen3-coder | mode: edit | permissions: ask
              </p>
              <p>
                <i>assistant</i> I found three changed files. I will inspect the
                diff first.
              </p>
              <p>
                <i>tool</i> git diff --stat
              </p>
              <p className="site-terminal-success">ready for local execution</p>
            </div>
          </div>
        </section>
        <section className="site-band">
          <div className="site-band-title">
            <p className="site-eyebrow">One runtime, four ways to work</p>
            <h2>Bring the agent to your workflow.</h2>
          </div>
          <p className="site-band-copy">
            Start in a shell, stay in your terminal, work inside VS Code, or
            open a dedicated desktop workspace without changing your local model
            setup or safety controls.
          </p>
          <Link className="site-text-link" href="/clients">
            Meet the clients
          </Link>
        </section>
        <section className="site-clients" aria-labelledby="clients-heading">
          <div className="site-section-heading">
            <p className="site-eyebrow">Client surfaces</p>
            <h2 id="clients-heading">
              Choose the interface, not a different agent.
            </h2>
          </div>
          <div className="site-client-grid">
            <article>
              <span>CLI</span>
              <h3>Automate from the shell</h3>
              <p>
                Run chat, model discovery, profiles, and durable workspace
                commands from scripts or your normal terminal.
              </p>
              <Link className="site-text-link" href="/clients/cli">
                Explore CLI
              </Link>
            </article>
            <article>
              <span>TUI</span>
              <h3>Stay in the terminal</h3>
              <p>
                Use a full-screen workspace with files, editor, Git diff
                preview, chat, shell output, approvals, and model controls.
              </p>
              <Link className="site-text-link" href="/clients/tui">
                Explore TUI
              </Link>
            </article>
            <article>
              <span>VS CODE</span>
              <h3>Work inside the editor</h3>
              <p>
                Get streaming chat, file context, inline completions, agent
                modes, approvals, and Git commit-message help in VS Code.
              </p>
              <div className="site-card-links">
                <a className="site-text-link" href="https://marketplace.visualstudio.com/items?itemName=truss-harness.truss-harness-vscode" target="_blank" rel="noreferrer">
                  Get extension
                </a>
                <Link className="site-text-link" href="/clients/vscode">
                  Explore VS Code
                </Link>
              </div>
            </article>
            <article>
              <span>DESKTOP</span>
              <h3>Open a focused workspace</h3>
              <p>
                Use the standalone Electron app for file browsing, diffs,
                terminal commands, chat, approvals, and a built-in Git workflow.
              </p>
              <div className="site-card-links">
                <Link className="site-text-link" href="/download">
                  Download desktop
                </Link>
                <Link className="site-text-link" href="/clients/desktop">
                  Explore desktop
                </Link>
              </div>
            </article>
          </div>
        </section>
        <section className="site-foundations">
          <div className="site-foundations-inner">
            <header className="site-foundations-intro">
              <p className="site-eyebrow">Built for real work</p>
              <h2>Everything stays under your control.</h2>
              <p>
                Local models are more useful when tools, context, and
                permissions are designed to work together.
              </p>
            </header>
            <div className="site-principles">
              <article>
                <span>01</span>
                <h3>Local by default</h3>
                <p>
                  Discover and connect Ollama, LM Studio, llama.cpp, or another
                  OpenAI-compatible local endpoint—without a cloud account.
                </p>
              </article>
              <article>
                <span>02</span>
                <h3>Tools with boundaries</h3>
                <p>
                  Read, write, search, grep, and terminal tools run through
                  agent modes and an explicit approval policy.
                </p>
              </article>
              <article>
                <span>03</span>
                <h3>State that carries forward</h3>
                <p>
                  Conversations, implementation plans, workspace memory,
                  Git-aware status, and deterministic commands keep work moving.
                </p>
              </article>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
