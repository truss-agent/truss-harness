import Link from "next/link";
import { brand } from "@truss-harness/branding";
import { SiteFooter, SiteHeader } from "../site-chrome";
import { createPageMetadata } from "../site-metadata";

export const metadata = createPageMetadata({
  title: "About",
  description: `Why ${brand.productName} is building a local-first, modular runtime for coding agents.`,
  path: "/about"
});

const principles = [
  {
    number: "01",
    title: "Local by default",
    description: "Use the model server you already trust and keep your workspace close to the tools doing the work."
  },
  {
    number: "02",
    title: "Boundaries you can see",
    description: "Choose what the agent can read, change, and run, then review sensitive actions before they happen."
  },
  {
    number: "03",
    title: "One runtime, many ways to work",
    description: "Carry the same models, tools, permissions, and workspace state between the shell, terminal, editor, and desktop."
  }
] as const;

const systems = [
  "Model providers",
  "Tools and permissions",
  "Context and memory",
  "Plans and sessions",
  "Client interfaces",
  "Storage and execution"
] as const;

const outcomes = [
  ["Start where you are", "Connect Ollama, LM Studio, llama.cpp, or another compatible endpoint without adopting a hosted control plane."],
  ["Stay in the loop", "See the context, tool activity, diffs, and approvals that shape the agent's work."],
  ["Keep moving", "Resume conversations and plans with useful workspace state instead of rebuilding context every time."]
] as const;

export default function AboutPage() {
  return (
    <div className="site">
      <SiteHeader />
      <main className="site-page about-page">
        <header className="site-page-intro about-hero">
          <p className="site-eyebrow">Why {brand.productName}</p>
          <h1>Coding agents should adapt to your workflow.</h1>
          <p>
            Truss is a local-first agent runtime that keeps models, tools,
            context, and permissions consistent across every way you work.
          </p>
        </header>

        <section className="about-story">
          <div className="about-story-heading">
            <p className="site-eyebrow">Why Truss exists</p>
            <h2>The interface should never become the platform.</h2>
          </div>
          <div className="about-story-copy">
            <p>
              Most coding agents are built around one editor, one provider, or
              one hosted service. That makes the first experience simple, but
              it also makes every future choice harder.
            </p>
            <p>
              Truss starts with the runtime instead. The CLI, terminal UI,
              VS Code extension, desktop app, and future clients all use the
              same agent foundation. You can change how you work without
              rebuilding the agent around a new interface.
            </p>
          </div>
        </section>

        <section className="about-principles" aria-labelledby="principles-heading">
          <header className="about-section-heading">
            <p className="site-eyebrow">A different foundation</p>
            <h2 id="principles-heading">Control where it matters. Consistency everywhere else.</h2>
            <p>Truss keeps the important choices explicit without making you configure the same workflow twice.</p>
          </header>
          <div className="about-principle-grid">
            {principles.map((principle) => (
              <article key={principle.number}>
                <span>{principle.number}</span>
                <h3>{principle.title}</h3>
                <p>{principle.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="about-platform">
          <div className="about-platform-copy">
            <p className="site-eyebrow">Built to evolve</p>
            <h2>Change the parts without replacing the whole.</h2>
            <p>
              Truss is TypeScript-first, event-driven, and organized around
              focused interfaces. New providers, tools, memory systems, and
              clients can grow independently while the core agent loop stays
              understandable and testable.
            </p>
          </div>
          <ul className="about-system-list" aria-label="Replaceable Truss systems">
            {systems.map((system, index) => (
              <li key={system}><span>{String(index + 1).padStart(2, "0")}</span>{system}</li>
            ))}
          </ul>
        </section>

        <section className="about-outcomes" aria-labelledby="outcomes-heading">
          <header className="about-section-heading">
            <p className="site-eyebrow">What that means for you</p>
            <h2 id="outcomes-heading">More control without more friction.</h2>
          </header>
          <div className="about-outcome-list">
            {outcomes.map(([title, description], index) => (
              <article key={title}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <h3>{title}</h3>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="site-callout about-cta">
          <div>
            <p className="site-eyebrow">Ready to try it?</p>
            <h2>Bring Truss to the workflow you already use.</h2>
          </div>
          <div className="site-actions">
            <Link className="site-button site-button-primary" href="/docs/getting-started">Get started</Link>
            <Link className="site-button site-button-secondary" href="/clients">Explore clients</Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
