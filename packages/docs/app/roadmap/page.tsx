import Link from "next/link";
import { SiteFooter, SiteHeader } from "../site-chrome";
import { createPageMetadata } from "../site-metadata";

const sections = [
  {
    label: "Available now",
    title: "Cloud providers, on your terms.",
    items: [
      "Bring your own API key for OpenAI, Anthropic, OpenRouter, Groq, Together AI, Gemini, xAI, Mistral AI, DeepSeek, Perplexity, Fireworks AI, or NVIDIA NIM.",
      "Keep provider selection, model routing, tools, and safety policies behind the same provider-neutral runtime interfaces.",
      "Store keys locally in the client or environment you control; Truss will not require a hosted control plane or proxy your requests."
    ]
  },
  {
    label: "Next up",
    title: "More places to work.",
    items: [
      "Native provider adapters and account flows where an API-key compatibility endpoint is not the right integration.",
      "A Neovim and LazyVim plugin that brings the same runtime into a keyboard-native editor workflow.",
      "Richer context selection through editor symbols, diagnostics, recent changes, and relationships between workspace files.",
      "A more capable MCP experience with clearer connection controls, discovery, and portable workspace configuration."
    ]
  },
  {
    label: "Longer term",
    title: "A modular platform for agent work.",
    items: [
      "Plugin registries and an SDK for providers, tools, memory, context sources, and client surfaces.",
      "Optional remote execution, sandboxes, model benchmarking, and multi-agent workflows without coupling the core runtime to one service.",
      "Session replay and durable workspace knowledge that make long-running work easier to inspect and resume."
    ]
  }
] as const;

export const metadata = createPageMetadata({ title: "Roadmap", description: "What Truss is building next, including bring-your-own-key cloud providers alongside its local-first coding-agent runtime.", path: "/roadmap" });

export default function RoadmapPage() {
  return <div className="site"><SiteHeader /><main className="site-page roadmap-page"><header className="site-page-intro"><p className="site-eyebrow">Roadmap</p><h1>Build locally. Extend everywhere.</h1><p>Truss is evolving in public. This is the direction we are actively working toward, not a promise of fixed delivery dates.</p></header><section className="changelog-list roadmap-list" aria-label="Product roadmap">{sections.map((section) => <article key={section.label}><header><span>{section.label}</span><p>{section.title}</p></header><ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul></article>)}</section><section className="site-callout"><div><p className="site-eyebrow">Today</p><h2>Start with the runtime you control.</h2></div><Link className="site-button site-button-primary" href="/docs/getting-started">Get started</Link></section></main><SiteFooter /></div>;
}
