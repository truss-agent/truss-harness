import Link from "next/link";
import { brand } from "@truss-harness/branding";
import { SiteFooter, SiteHeader } from "./site-chrome";
import { LandingMotion } from "./landing-motion";
import { createPageMetadata } from "./site-metadata";

export const metadata = createPageMetadata({ title: brand.productName, description: "A modular, local-first coding-agent runtime with optional BYOK cloud models for CLI, terminal, VS Code, and desktop workflows.", path: "/" });

export default function HomePage() {
  return (
    <div className="site">
      <SiteHeader />
      <main>
        <LandingMotion>
        <section className="site-hero">
          <div className="site-hero-copy">
            <p className="site-eyebrow">Local-first coding agents</p>
            <h1>A coding agent that works your way.</h1>
            <p className="site-lede">
              Plan, edit, and review code with local models from the shell,
              terminal, VS Code, or desktop—with the same tools, workspace
              state, and approval controls everywhere.
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
            </div>
          </div>
          <div className="site-terminal" aria-label="Truss CLI preview">
            <div className="site-terminal-bar">
              <span>truss-harness CLI</span>
              <span>local workspace</span>
            </div>
            <div className="site-terminal-body">
              <p>
                <b>$</b><span data-terminal-command> truss-harness chat "Review the current diff"</span><span className="site-terminal-cursor" data-terminal-cursor aria-hidden="true">▋</span><span className="site-terminal-enter" data-terminal-enter aria-hidden="true">↵</span>
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
        <section className="site-band" data-reveal>
          <div className="site-band-title">
            <p className="site-eyebrow">One runtime, four ways to work</p>
            <h2>Bring the agent to your workflow.</h2>
          </div>
          <p className="site-band-copy">
            Start in a shell, stay in your terminal, work inside VS Code, or
            open a dedicated desktop workspace without changing your local model
            setup or safety controls.
          </p>
          <Link className="site-button site-button-secondary" href="/clients">
            Meet the clients
          </Link>
        </section>
        <section className="site-clients" aria-labelledby="clients-heading" data-reveal>
          <div className="site-section-heading">
            <p className="site-eyebrow">Client surfaces</p>
            <h2 id="clients-heading">
              Choose the interface, not a different agent.
            </h2>
            <p className="site-section-subtitle">
              One agent across your shell, terminal, editor, and desktop workspace.
            </p>
          </div>
          <div className="site-client-grid" data-stagger>
            <article>
              <span>CLI</span>
                <h3>Automate from your shell</h3>
              <p>
                Run coding tasks, discover local models, and reuse workspace
                profiles from scripts or your normal terminal.
              </p>
              <Link className="site-button site-button-secondary" href="/clients/cli">
                Explore CLI
              </Link>
            </article>
            <article>
              <span>TUI</span>
                <h3>Keep your flow in the terminal</h3>
              <p>
                Use a full-screen workspace with files, editor, Git diff
                preview, chat, shell output, approvals, and model controls.
              </p>
              <Link className="site-button site-button-secondary" href="/clients/tui">
                Explore TUI
              </Link>
            </article>
            <article>
              <span>VS CODE</span>
                <h3>Work where you edit</h3>
              <p>
                Get streaming chat, file context, inline completions, agent
                modes, approvals, and Git commit-message help in VS Code.
              </p>
              <Link className="site-button site-button-secondary" href="/clients/vscode">
                Explore VS Code
              </Link>
            </article>
            <article>
              <span>DESKTOP</span>
                <h3>Open a dedicated workspace</h3>
              <p>
                Use the standalone Electron app for file browsing, diffs,
                terminal commands, chat, approvals, and a built-in Git workflow.
              </p>
              <Link className="site-button site-button-secondary" href="/clients/desktop">
                Explore desktop
              </Link>
            </article>
          </div>
        </section>
        <section className="site-foundations" data-reveal>
          <div className="site-foundations-inner">
            <header className="site-foundations-intro">
              <p className="site-eyebrow">Built for real work</p>
              <h2>Powerful coding help. Clear control.</h2>
              <p>
                Bring your own model, keep workspace context close, and review
                what the agent can do before it acts.
              </p>
            </header>
            <div className="site-principles" data-stagger>
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
                <h3>Cloud on your terms</h3>
                <p>
                  Add a supported provider through an API key you control. Truss
                  does not require a hosted control plane or proxy model requests.
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
              <article>
                <span>04</span>
                <h3>Context with intent</h3>
                <p>
                  Open files, recent edits, Git changes, plans, and workspace
                  memory give the agent useful context without sending the
                  whole repository.
                </p>
              </article>
              <article>
                <span>05</span>
                <h3>Approvals stay visible</h3>
                <p>
                  Choose the permission policy that fits the task, then review
                  requested reads, writes, terminal commands, and network work
                  before it runs.
                </p>
              </article>
              <article>
                <span>06</span>
                <h3>Built to be replaced</h3>
                <p>
                  Providers, tools, context sources, memory, and clients are
                  separate interfaces—so new capabilities do not rewrite the
                  agent runtime.
                </p>
              </article>
            </div>
          </div>
        </section>
        </LandingMotion>
      </main>
      <SiteFooter />
    </div>
  );
}
