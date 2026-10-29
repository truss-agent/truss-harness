import { brand } from "@truss-harness/branding";
import { createPageMetadata } from "./site-metadata";

export interface RouteMetadata {
  readonly path: `/${string}`;
  readonly title: string;
  readonly description: string;
}

export const docsRoutes = [
  {
    path: "/docs",
    title: "Documentation",
    description:
      "Learn how to install, configure, and extend the Truss coding-agent runtime and its clients.",
  },
  {
    path: "/docs/getting-started",
    title: "Get Started",
    description:
      "Install Truss, choose a local or cloud model, and run your first chat or approved editing task.",
  },
  {
    path: "/docs/configuration",
    title: "Configuration",
    description:
      "Configure Truss profiles, workspace trust, provider credentials, and settings precedence.",
  },
  {
    path: "/docs/local-models",
    title: "Local Models",
    description:
      "Connect Truss to Ollama, LM Studio, or llama.cpp and select a tool-capable local model.",
  },
  {
    path: "/docs/troubleshooting",
    title: "Troubleshooting",
    description:
      "Diagnose Truss installation, provider connectivity, model discovery, and tool-calling problems.",
  },
  {
    path: "/docs/development",
    title: "Development",
    description:
      "Build and test Truss packages and learn the modular runtime and client architecture.",
  },
  {
    path: "/docs/development/branding",
    title: "Branding",
    description:
      "Customize Truss branding through the shared brand configuration and generated assets.",
  },
  {
    path: "/docs/clients/cli",
    title: "CLI Guide",
    description:
      "Use Truss CLI commands for chat, editing, configuration, and local runtime services.",
  },
  {
    path: "/docs/clients/tui",
    title: "Terminal UI Guide",
    description:
      "Run the Truss terminal UI with conversations, context, local models, and tool approvals.",
  },
  {
    path: "/docs/clients/vscode",
    title: "VS Code Guide",
    description:
      "Install and configure the Truss VS Code extension for editor chat, context, and approved edits.",
  },
  {
    path: "/docs/clients/desktop",
    title: "Desktop Guide",
    description:
      "Set up Truss Desktop for workspace files, Git, terminal tasks, and provider settings.",
  },
  {
    path: "/docs/clients/neovim",
    title: "Truss for Neovim",
    description:
      "Install truss.nvim in Neovim or LazyVim and configure its local CLI service and key mappings.",
  },
  {
    path: "/docs/clients/truss-go",
    title: "Truss Go for Android",
    description:
      "Pair Truss Go with a trusted Desktop or VS Code workspace and manage mobile tool approvals.",
  },
  {
    path: "/docs/runtime/tools",
    title: "Runtime Tools",
    description:
      "Understand Truss workspace tools, execution boundaries, and approval policies.",
  },
  {
    path: "/docs/runtime/mcp",
    title: "MCP Servers",
    description:
      "Connect MCP servers to Truss with explicit workspace trust, tool modes, and safety controls.",
  },
  {
    path: "/docs/runtime/plans",
    title: "Plans",
    description:
      "Create and execute iterative Truss plans with task progress and approval controls.",
  },
  {
    path: "/docs/runtime/managed-agents",
    title: "Managed Agents",
    description:
      "Configure managed Truss agents and their workspace instructions and execution settings.",
  },
  {
    path: "/docs/runtime/workspace-commands",
    title: "Workspace Commands",
    description:
      "Use Truss workspace commands to initialize project context and update durable guidance.",
  },
  {
    path: "/docs/runtime/workspace-memory",
    title: "Workspace Memory",
    description:
      "Manage Truss workspace summaries, durable memory, and project context between conversations.",
  },
] as const satisfies readonly RouteMetadata[];

export type DocsPath = (typeof docsRoutes)[number]["path"];

export function createDocsMetadata(path: DocsPath) {
  const route = docsRoutes.find((entry) => entry.path === path);
  if (!route) throw new Error(`Unknown documentation route: ${path}`);
  return {
    ...createPageMetadata(route),
    title: { default: route.title, template: `%s | ${brand.productName}` },
  };
}

export const publicPagePaths = [
  "/",
  "/about",
  "/blog",
  "/changelog",
  "/roadmap",
  "/clients",
  "/clients/cli",
  "/clients/tui",
  "/clients/vscode",
  "/clients/desktop",
  "/download",
  "/features",
  "/truss-go",
  ...docsRoutes.map((route) => route.path),
] as const;
