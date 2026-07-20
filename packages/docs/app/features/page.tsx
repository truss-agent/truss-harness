import Link from "next/link";
import { brand } from "@truss-harness/branding";
import { SiteFooter, SiteHeader } from "../site-chrome";
import { createPageMetadata } from "../site-metadata";

const features = [
  ["Local model discovery", "Find Ollama, LM Studio, llama.cpp, and compatible local servers, then save the model setup that works for each workspace."],
  ["CLI and service mode", "Run coding tasks from the shell, automate repeatable workspace commands, or provide the JSON-lines service used by editor clients."],
  ["Full-screen terminal UI", "Stay in a keyboard-first workspace with files, Git diffs, agent chat, shell output, model settings, and approvals close at hand."],
  ["VS Code extension", "Bring streaming chat, focused file context, inline completions, approvals, agent modes, and Git-aware actions into your editor."],
  ["Standalone desktop app", "Open a focused workspace for files, diffs, terminal commands, persistent chat, model controls, approvals, and everyday Git work."],
  ["Durable agent workflow", "Save workspace memory, implementation plans, Git-aware status, task notes, and conversation history—then resume with useful context."],
  ["Controlled tool execution", "Give the agent the tools it needs while keeping Chat, Plan, Edit, and approval policies explicit."],
  ["Streaming and interruption", "See responses and tool activity as they happen, stop a run when needed, and recover cleanly when a session is interrupted."],
  ["Replaceable foundations", "Swap providers, tools, memory, context sources, and clients without rebuilding the runtime around one vendor or editor."]
] as const;

export const metadata = createPageMetadata({ title: "Features", description: `See how ${brand.productName} helps you plan, edit, and review code with local models.`, path: "/features" });

export default function FeaturesPage() {
  return <div className="site"><SiteHeader /><main className="site-page"><header className="site-page-intro"><p className="site-eyebrow">Current capabilities</p><h1>One local agent platform, ready in every workspace.</h1><p>Truss keeps the runtime independent from its interfaces. Its CLI, terminal UI, VS Code extension, and desktop app share the same local-model discovery, tools, permissions, and durable workspace state.</p></header><section id="clients" className="site-client-summary" aria-labelledby="client-summary-heading"><div><p className="site-eyebrow">Available today</p><h2 id="client-summary-heading">Four clients. One runtime.</h2></div><p><strong>CLI</strong> for automation, <strong>TUI</strong> for terminal-native work, <strong>VS Code</strong> for editor workflows, and a <strong>desktop app</strong> for a dedicated local workspace.</p></section><section className="site-feature-grid">{features.map(([title, description], index) => <article key={title} className="site-feature"><span>{String(index + 1).padStart(2, "0")}</span><h2>{title}</h2><p>{description}</p></article>)}</section><section className="site-callout"><div><p className="site-eyebrow">Implementation details</p><h2>See the interfaces, configuration, and local setup.</h2></div><Link className="site-button site-button-primary" href="/docs">Open documentation</Link></section></main><SiteFooter /></div>;
}
