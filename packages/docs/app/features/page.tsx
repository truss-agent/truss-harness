import Link from "next/link";
import { brand } from "@truss-harness/branding";
import { SiteFooter, SiteHeader } from "../site-chrome";

const features = [
  ["Local model discovery", "Find Ollama, LM Studio, llama.cpp, and other compatible local servers, choose a model, and keep reusable workspace-aware profiles."],
  ["CLI and service mode", "Run agents and deterministic workspace commands from the shell, or host the newline-delimited JSON service used by editor clients."],
  ["Full-screen terminal UI", "Work in a keyboard-first TUI with files, editor, Git diff preview, chat, shell output, model settings, and approvals."],
  ["VS Code extension", "Use streaming chat, bounded file attachments, inline completions, tool approvals, agent modes, and commit-message generation in the editor."],
  ["Standalone desktop app", "Open a three-pane Electron workspace with a file tree, editor and diff preview, terminal, persistent chat, safe IPC, and Git stage, commit, pull, and push actions."],
  ["Durable agent workflow", "Save workspace memory, implementation plans, Git-aware status, task notes, and conversation history—then resume with useful context."],
  ["Controlled tool execution", "Read, write, list, search, grep, and terminal tools run through typed registration, Chat/Plan/Edit modes, and a chosen approval policy."],
  ["Streaming and interruption", "Every client renders the runtime's token, tool, approval, and lifecycle events, including cancellation and fresh-session recovery."],
  ["Replaceable foundations", "Providers, tools, context sources, session storage, memory, plans, and clients are isolated behind focused TypeScript interfaces."]
] as const;

export const metadata = {
  title: "Features",
  description: `Local-model, tool-execution, and client capabilities in ${brand.productName}.`
};

export default function FeaturesPage() {
  return <div className="site"><SiteHeader /><main className="site-page"><header className="site-page-intro"><p className="site-eyebrow">Current capabilities</p><h1>One local agent platform, ready in every workspace.</h1><p>Truss keeps the runtime independent from its interfaces. Its CLI, terminal UI, VS Code extension, and desktop app share the same local-model discovery, tools, permissions, and durable workspace state.</p></header><section id="clients" className="site-client-summary" aria-labelledby="client-summary-heading"><div><p className="site-eyebrow">Available today</p><h2 id="client-summary-heading">Four clients. One runtime.</h2></div><p><strong>CLI</strong> for automation, <strong>TUI</strong> for terminal-native work, <strong>VS Code</strong> for editor workflows, and a <strong>desktop app</strong> for a dedicated local workspace.</p></section><section className="site-feature-grid">{features.map(([title, description], index) => <article key={title} className="site-feature"><span>{String(index + 1).padStart(2, "0")}</span><h2>{title}</h2><p>{description}</p></article>)}</section><section className="site-callout"><div><p className="site-eyebrow">Implementation details</p><h2>See the interfaces, configuration, and local setup.</h2></div><Link className="site-button site-button-primary" href="/docs">Open documentation</Link></section></main><SiteFooter /></div>;
}
