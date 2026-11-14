import Link from "next/link";
import { brand } from "@truss-harness/branding";
import { SiteFooter, SiteHeader } from "./site-chrome";
import { LandingMotion } from "./landing-motion";
import { HeroScene, Spotlight } from "./hero-scene";
import { createPageMetadata } from "./site-metadata";

export const metadata = createPageMetadata({
  title: brand.productName,
  description:
    "Truss is a free, open-source AI coding agent. It reads your code, plans changes, edits files and runs commands with your approval, using any model you choose, from the terminal, VS Code, Neovim or a desktop app.",
  path: "/",
});

const steps = [
  {
    title: "Pick a model",
    body: "Point Truss at a model running on your machine, such as Ollama or LM Studio, or paste your own key for OpenAI, Anthropic, Gemini, OpenRouter and others.",
  },
  {
    title: "Describe the task",
    body: "Ask a question, request a plan, or tell it to make the change. Truss reads the relevant files, searches the codebase and works out the steps.",
  },
  {
    title: "Review and approve",
    body: "Before it writes a file or runs a command, Truss shows you the diff or the command and waits for your OK. You stay in charge of what changes.",
  },
];

const clients = [
  {
    tag: "CLI",
    title: "Command line",
    body: "Run tasks straight from your shell or in scripts.",
    href: "/clients/cli",
    cta: "Explore CLI",
  },
  {
    tag: "TUI",
    title: "Terminal workspace",
    body: "Files, editor, diffs, chat and shell in one full-screen terminal app.",
    href: "/clients/tui",
    cta: "Explore TUI",
  },
  {
    tag: "VS CODE",
    title: "VS Code extension",
    body: "Chat, file context, inline completions and approvals inside your editor.",
    href: "/clients/vscode",
    cta: "Explore VS Code",
  },
  {
    tag: "DESKTOP",
    title: "Desktop app",
    body: "A dedicated workspace with files, diffs, terminal, Git and chat.",
    href: "/clients/desktop",
    cta: "Explore desktop",
  },
  {
    tag: "NEOVIM",
    title: "Neovim plugin",
    body: "Native Chat, Plan and Edit with diff previews, without leaving Neovim.",
    href: `${brand.repositoryUrl}/tree/master/packages/neovim`,
    cta: "Explore Neovim",
  },
  {
    tag: "ANDROID",
    title: "Truss Go",
    body: "Check on and continue a desktop or VS Code session from your phone.",
    href: "/truss-go",
    cta: "Explore Truss Go",
  },
];

const principles = [
  {
    title: "Any model, your choice",
    body: "Local models for privacy and zero cost, or cloud models with your own key. Switch any time; nothing is tied to one vendor.",
  },
  {
    title: "Nothing happens behind your back",
    body: "Choose what Truss may read, change and run. Risky steps wait for your approval, with a diff or command preview.",
  },
  {
    title: "Same agent everywhere",
    body: "Your models, settings, plans and history follow you between the terminal, editor, desktop and phone.",
  },
  {
    title: "Picks up where you left off",
    body: "Conversations, plans and project notes are saved in your workspace, so the next session starts with context.",
  },
  {
    title: "Sends only what matters",
    body: "Open files, recent edits and Git changes give the model useful context without uploading your whole repository.",
  },
  {
    title: "Free and open source",
    body: "MIT licensed. Runs on your machine with no account and no hosted service in the middle. Read it, fork it, extend it.",
  },
];

export default function HomePage() {
  return (
    <div className="site">
      <SiteHeader />
      <Spotlight />
      <main>
        <LandingMotion>
          <section className="site-hero holo-hero">
            <HeroScene />
            <div className="holo-hero-veil" aria-hidden="true" />
            <div className="site-hero-copy">
              <p className="site-eyebrow">
                <span className="holo-dot" aria-hidden="true" />
                Free · open source · runs on your machine
              </p>
              <h1>
                The AI coding agent that works <em>where you do.</em>
              </h1>
              <p className="site-lede">
                Truss reads your code, plans changes, edits files and runs
                commands, and asks before anything risky. Use it from the
                terminal, VS Code, Neovim or a desktop app, with a local model
                or your own API key.
              </p>
              <div className="site-actions">
                <Link
                  className="site-button site-button-primary"
                  href="/download"
                >
                  Get Truss free
                </Link>
                <Link
                  className="site-button site-button-secondary"
                  href="/docs/getting-started"
                >
                  See how it works
                </Link>
              </div>
              <ul className="holo-chips" aria-label="Highlights">
                <li>Ollama · LM Studio · llama.cpp</li>
                <li>OpenAI · Anthropic · Gemini · OpenRouter</li>
                <li>MIT license</li>
              </ul>
            </div>
            <div className="site-terminal" data-spotlight>
              <div className="site-terminal-bar">
                <span>truss-cli</span>
                <span>~/projects/web-app</span>
              </div>
              <div className="site-terminal-body">
                <p>
                  <b>$</b>
                  <span data-terminal-command>
                    {" "}
                    truss-cli chat "Fix the failing login test"
                  </span>
                  <span
                    className="site-terminal-cursor"
                    data-terminal-cursor
                    aria-hidden="true"
                  >
                    ▋
                  </span>
                  <span
                    className="site-terminal-enter"
                    data-terminal-enter
                    aria-hidden="true"
                  >
                    ↵
                  </span>
                </p>
                <p className="site-terminal-muted">
                  model: qwen3-coder (local) · mode: edit · approvals: ask
                </p>
                <p>
                  <i>truss</i> Read 3 files. The test expects a redirect the
                  handler no longer sends.
                </p>
                <p>
                  <i>approve?</i> edit src/auth/login.ts (+4 −1)
                </p>
                <p className="site-terminal-success">
                  ✓ approved · npm test passed
                </p>
              </div>
            </div>
          </section>

          <section
            className="holo-steps"
            aria-labelledby="steps-heading"
            data-reveal
          >
            <div className="site-section-heading">
              <p className="site-eyebrow">How it works</p>
              <h2 id="steps-heading">Ask. Review. Ship.</h2>
              <p className="site-section-subtitle">
                Truss is an assistant that can actually do the work in your
                project, not just suggest it, while you approve every change.
              </p>
            </div>
            <ol className="holo-step-grid" data-stagger>
              {steps.map((step, index) => (
                <li key={step.title} className="holo-card" data-spotlight>
                  <span className="holo-step-n">0{index + 1}</span>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </li>
              ))}
            </ol>
          </section>

          <section
            className="site-clients"
            aria-labelledby="clients-heading"
            data-reveal
          >
            <div className="site-section-heading">
              <p className="site-eyebrow">One agent, six ways to use it</p>
              <h2 id="clients-heading">Use the tool you already like.</h2>
              <p className="site-section-subtitle">
                Every app runs the same Truss agent, so your models, settings
                and history come with you.
              </p>
            </div>
            <div className="site-client-grid holo-client-grid" data-stagger>
              {clients.map((client) => (
                <article key={client.tag} className="holo-card" data-spotlight>
                  <span>{client.tag}</span>
                  <h3>{client.title}</h3>
                  <p>{client.body}</p>
                  <Link
                    className="site-button site-button-secondary"
                    href={client.href}
                  >
                    {client.cta}
                  </Link>
                </article>
              ))}
            </div>
          </section>

          <section className="site-foundations" data-reveal>
            <div className="site-foundations-inner">
              <header className="site-foundations-intro">
                <p className="site-eyebrow">Why Truss</p>
                <h2>Powerful help. You stay in control.</h2>
                <p>
                  Built for developers who want a capable agent without giving
                  up their tools, their models or their say over what changes.
                </p>
              </header>
              <div className="site-principles" data-stagger>
                {principles.map((principle, index) => (
                  <article
                    key={principle.title}
                    className="holo-card"
                    data-spotlight
                  >
                    <span>0{index + 1}</span>
                    <h3>{principle.title}</h3>
                    <p>{principle.body}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <section className="holo-cta" data-reveal>
            <h2>Try it on your own code in two minutes.</h2>
            <p>
              <code>npm install --global @truss-harness/cli</code>, or grab the
              desktop app or VS Code extension.
            </p>
            <div className="site-actions">
              <Link
                className="site-button site-button-primary"
                href="/download"
              >
                Download Truss
              </Link>
              <a
                className="site-button site-button-secondary"
                href={brand.repositoryUrl}
                target="_blank"
                rel="noreferrer"
              >
                Star on GitHub
              </a>
            </div>
          </section>
        </LandingMotion>
      </main>
      <SiteFooter />
    </div>
  );
}
