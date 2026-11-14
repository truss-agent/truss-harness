import { brand } from "@truss-harness/branding";
import Link from "next/link";
import type { ReactNode } from "react";
import { AgentShowcase } from "./agent-showcase";
import { HeroScene, Spotlight } from "./hero-scene";
import { LandingMotion } from "./landing-motion";
import { SiteFooter, SiteHeader } from "./site-chrome";
import { createPageMetadata } from "./site-metadata";

export const metadata = createPageMetadata({
  title: brand.productName,
  description:
    "Truss is a free, open-source AI coding agent. It reads your code, makes changes and runs commands with your approval, using any model you choose, from the terminal, VS Code, Neovim or a desktop app.",
  path: "/",
});

const icon = (d: string): ReactNode => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <path
      d={d}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const icons = {
  model: icon("M12 3 3 8l9 5 9-5-9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"),
  chat: icon("M4 5h16v11H8l-4 4V5Zm4 5h8M8 13h5"),
  check: icon("M4 12.5 9 17 20 6"),
  terminal: icon("M4 5h16v14H4zM7 9l3 3-3 3m5 0h5"),
  grid: icon("M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z"),
  code: icon("M8 7l-5 5 5 5m8-10 5 5-5 5M14 4l-4 16"),
  window: icon("M3 5h18v14H3zM3 9h18M7 7h.01"),
  vim: icon("M5 4h5l2 9 2-9h5L14 20h-4z"),
  phone: icon("M8 3h8v18H8zm3 15h2"),
  shield: icon(
    "M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6l-8-3Zm-3 9 2 2 4-4",
  ),
  sync: icon(
    "M4 12a8 8 0 0 1 14-5l2 2M20 12a8 8 0 0 1-14 5l-2-2M20 4v5h-5M4 20v-5h5",
  ),
  memory: icon("M6 4h12v16H6zM9 8h6M9 12h6M9 16h3"),
  target: icon(
    "M12 3v3m0 12v3M3 12h3m12 0h3M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
  ),
  open: icon("M9 18 3 12l6-6m6 0 6 6-6 6"),
};

const steps = [
  {
    icon: icons.model,
    title: "Pick a model",
    body: "Run one on your machine with Ollama, LM Studio or llama.cpp, or paste your own key for OpenAI, Anthropic, Gemini, OpenRouter and more.",
    tags: "Local · BYOK · 15+ providers",
  },
  {
    icon: icons.chat,
    title: "Say what you need",
    body: "Ask a question, request a plan, or tell it to make the change. Truss reads the right files, searches the code and runs the checks.",
    tags: "Chat · Plan · Edit",
  },
  {
    icon: icons.check,
    title: "Approve what changes",
    body: "Before Truss writes a file or runs a command, you see the diff or the command and decide. Nothing lands without your say.",
    tags: "Diffs · Approvals · Undo",
  },
];

const clients = [
  {
    icon: icons.terminal,
    tag: "CLI",
    title: "Command line",
    body: "Run tasks from your shell or in scripts and CI.",
    href: "/clients/cli",
  },
  {
    icon: icons.grid,
    tag: "TUI",
    title: "Terminal workspace",
    body: "Files, editor, diffs, chat and shell in one full-screen terminal app.",
    href: "/clients/tui",
  },
  {
    icon: icons.code,
    tag: "VS CODE",
    title: "VS Code extension",
    body: "Chat, file context, inline completions and approvals in your editor.",
    href: "/clients/vscode",
  },
  {
    icon: icons.window,
    tag: "DESKTOP",
    title: "Desktop app",
    body: "A dedicated workspace with files, diffs, terminal, Git and chat.",
    href: "/clients/desktop",
  },
  {
    icon: icons.vim,
    tag: "NEOVIM",
    title: "Neovim plugin",
    body: "Native Chat, Plan and Edit with diff previews, without leaving Neovim.",
    href: `${brand.repositoryUrl}/tree/master/packages/neovim`,
  },
  {
    icon: icons.phone,
    tag: "ANDROID",
    title: "Truss Go",
    body: "Check on and continue a desktop or VS Code session from your phone.",
    href: "/truss-go",
  },
];

const principles = [
  {
    icon: icons.model,
    title: "Any model, your choice",
    body: "Local for privacy and zero cost, or cloud with your own key. Switch any time; nothing is tied to one vendor.",
    tags: "No lock-in",
  },
  {
    icon: icons.shield,
    title: "Nothing behind your back",
    body: "Choose what Truss may read, change and run. Risky steps wait for you, with a preview of exactly what happens.",
    tags: "Permissions · Approvals",
  },
  {
    icon: icons.sync,
    title: "Same agent everywhere",
    body: "Your models, settings, plans and history follow you between terminal, editor, desktop and phone.",
    tags: "One runtime",
  },
  {
    icon: icons.memory,
    title: "Remembers the project",
    body: "Conversations, plans and project notes live in your workspace, so the next session starts with context.",
    tags: "Plans · Memory",
  },
  {
    icon: icons.target,
    title: "Sends only what matters",
    body: "Open files, recent edits and Git changes give the model what it needs without uploading the whole repo.",
    tags: "Focused context",
  },
  {
    icon: icons.open,
    title: "Free and open source",
    body: "MIT licensed. No account, no hosted middleman. Read it, fork it, extend it with your own tools.",
    tags: "MIT · Local-first",
  },
];

const providers = [
  "Ollama",
  "LM Studio",
  "llama.cpp",
  "OpenAI",
  "Anthropic",
  "Gemini",
  "OpenRouter",
  "Mistral",
  "DeepSeek",
  "Groq",
  "xAI",
  "Together",
];

function Cell(props: {
  readonly icon: ReactNode;
  readonly index: number;
  readonly title: string;
  readonly body: string;
  readonly tags: string;
  readonly href?: string;
}) {
  const inner = (
    <>
      <div className="cell-top">
        <span className="cell-icon">{props.icon}</span>
        <span className="cell-n">
          {String(props.index + 1).padStart(2, "0")}
        </span>
      </div>
      <h3>{props.title}</h3>
      <p>{props.body}</p>
      <span className="cell-tags">
        {props.tags}
        {props.href ? <b aria-hidden="true"> →</b> : null}
      </span>
    </>
  );
  return props.href ? (
    <Link className="cell holo-card" href={props.href} data-spotlight>
      {inner}
    </Link>
  ) : (
    <article className="cell holo-card" data-spotlight>
      {inner}
    </article>
  );
}

export default function HomePage() {
  return (
    <div className="site holo-page">
      <SiteHeader />
      <Spotlight />
      <main>
        <LandingMotion>
          <section className="site-hero holo-hero">
            <HeroScene />
            <div className="holo-hero-veil" aria-hidden="true" />
            <span className="hud hud-tl" aria-hidden="true" />
            <span className="hud hud-tr" aria-hidden="true" />
            <div className="site-hero-copy">
              <p className="site-eyebrow">
                <span className="holo-dot" aria-hidden="true" />
                Open-source AI coding agent
              </p>
              <h1>
                One coding agent.
                <span>Every place you code.</span>
              </h1>
              <p className="site-lede">
                Truss reads your code, makes the changes and runs the commands,
                and asks before anything risky. Use it in the terminal, VS Code,
                Neovim or a desktop app, with a local model or your own API key.
              </p>
              <div className="site-actions">
                <Link
                  className="site-button site-button-primary"
                  href="/download"
                >
                  Get Truss free <span aria-hidden="true">→</span>
                </Link>
                <a className="site-button site-button-secondary" href="#see-it">
                  See it work <span aria-hidden="true">↓</span>
                </a>
              </div>
              <p className="holo-meta">
                <span>MIT licensed</span>
                <span>No account</span>
                <span>Runs on your machine</span>
                <span>Local or cloud models</span>
              </p>
            </div>
          </section>

          <section
            id="see-it"
            className="holo-showcase"
            aria-label="Interactive preview"
          >
            <div className="holo-showcase-label">
              <span>
                <i aria-hidden="true" /> Three agents. One workspace.
              </span>
              <span>Click an agent. Try approving the edit. ↙</span>
            </div>
            <AgentShowcase />
          </section>

          <section
            className="holo-marquee"
            aria-label="Supported model providers"
          >
            <div className="holo-marquee-track">
              {[0, 1].map((copy) =>
                providers.map((p) => (
                  <span
                    key={`${copy}-${p}`}
                    aria-hidden={copy === 1 ? true : undefined}
                  >
                    {p}
                    <b aria-hidden="true">✕</b>
                  </span>
                )),
              )}
            </div>
          </section>

          <section
            className="holo-section"
            aria-labelledby="steps-heading"
            data-reveal
          >
            <header className="holo-head">
              <div>
                <p className="holo-kicker">How it works</p>
                <h2 id="steps-heading">
                  Ask. Review.
                  <span> Ship.</span>
                </h2>
              </div>
              <p>
                An assistant that does the work in your project, not just
                suggests it, while you approve every change.
              </p>
            </header>
            <div className="cell-grid cell-grid-3" data-stagger>
              {steps.map((s, i) => (
                <Cell key={s.title} index={i} {...s} />
              ))}
            </div>
          </section>

          <section
            className="holo-section"
            aria-labelledby="clients-heading"
            data-reveal
          >
            <header className="holo-head">
              <div>
                <p className="holo-kicker">One agent, six apps</p>
                <h2 id="clients-heading">
                  Use the tool
                  <span> you already like.</span>
                </h2>
              </div>
              <p>
                Every app runs the same Truss agent, so your models, settings
                and history come with you.{" "}
                <Link href="/clients">Compare the apps →</Link>
              </p>
            </header>
            <div className="cell-grid cell-grid-3" data-stagger>
              {clients.map((c, i) => (
                <Cell
                  key={c.tag}
                  index={i}
                  icon={c.icon}
                  title={c.title}
                  body={c.body}
                  tags={c.tag}
                  href={c.href}
                />
              ))}
            </div>
          </section>

          <section
            className="holo-section"
            aria-labelledby="why-heading"
            data-reveal
          >
            <header className="holo-head">
              <div>
                <p className="holo-kicker">Why Truss</p>
                <h2 id="why-heading">
                  Powerful help.
                  <span> You stay in control.</span>
                </h2>
              </div>
              <p>
                For developers who want a capable agent without giving up their
                tools, their models or their say over what changes.
              </p>
            </header>
            <div className="cell-grid cell-grid-3" data-stagger>
              {principles.map((p, i) => (
                <Cell key={p.title} index={i} {...p} />
              ))}
            </div>
          </section>

          <section className="holo-cta" data-reveal>
            <span className="hud hud-tl" aria-hidden="true" />
            <span className="hud hud-tr" aria-hidden="true" />
            <span className="hud hud-bl" aria-hidden="true" />
            <span className="hud hud-br" aria-hidden="true" />
            <p className="holo-kicker">Two minutes to first task</p>
            <h2>Try it on your own code.</h2>
            <div className="holo-install">
              <span>$</span> npm install --global @truss-harness/cli
            </div>
            <div className="site-actions">
              <Link
                className="site-button site-button-primary"
                href="/download"
              >
                Download Truss <span aria-hidden="true">→</span>
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
