import Link from "next/link";
import { brand } from "@truss-harness/branding";
import { SiteFooter, SiteHeader } from "./site-chrome";

export const metadata = {
  title: brand.productName,
  description: "A modular, local-first coding-agent harness for local model workflows."
};

export default function HomePage() {
  return <div className="site"><SiteHeader /><main><section className="site-hero"><div className="site-hero-copy"><p className="site-eyebrow">Local-first coding agents</p><h1>{brand.productName}</h1><p className="site-lede">A modular coding-agent harness built for local models, native tool calling, and the workflows developers actually use.</p><div className="site-actions"><Link className="site-button site-button-primary" href="/docs">Read the docs</Link><Link className="site-button site-button-secondary" href="/features">Explore features</Link></div></div><div className="site-terminal" aria-label="Truss runtime preview"><div className="site-terminal-bar"><span>truss-cli</span><span>local workspace</span></div><div className="site-terminal-body"><p><b>$</b> truss-cli chat "Review the current diff"</p><p className="site-terminal-muted">model: qwen3-coder | mode: edit | permissions: ask</p><p><i>assistant</i> I found three changed files. I will inspect the diff first.</p><p><i>tool</i> git diff --stat</p><p className="site-terminal-success">ready for local execution</p></div></div></section><section className="site-band"><div><p className="site-eyebrow">One runtime, several clients</p><h2>Keep the agent portable.</h2></div><p>Use the same sessions, approvals, tools, context, and local-model configuration from the CLI, terminal workspace, or VS Code.</p><Link className="site-text-link" href="/features">See the client surface</Link></section><section className="site-principles"><article><span>01</span><h3>Local by default</h3><p>Connect Ollama, LM Studio, llama.cpp, or a compatible endpoint without a cloud account requirement.</p></article><article><span>02</span><h3>Tools with boundaries</h3><p>Filesystem and terminal capabilities run through an approval and permission layer instead of a UI-specific shortcut.</p></article><article><span>03</span><h3>Context that persists</h3><p>Workspace memory and deterministic commands carry progress forward between conversations.</p></article></section></main><SiteFooter /></div>;
}
