export type ClientId = "cli" | "tui" | "vscode" | "desktop";

export type ClientContent = {
  readonly id: ClientId;
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly screenshotHint: string;
  readonly installLabel: string;
  readonly installDescription: string;
  readonly commands?: readonly string[];
  readonly primaryAction: { readonly label: string; readonly href: string; readonly external?: boolean };
  readonly docsHref: string;
  readonly highlights: readonly { readonly title: string; readonly description: string }[];
  readonly workflow: readonly string[];
};

export const clientContent: Record<ClientId, ClientContent> = {
  cli: {
    id: "cli",
    eyebrow: "Truss CLI",
    title: "The coding agent that fits your shell.",
    description: "Run local-model agent tasks from a terminal, automate them in scripts, or host the JSON-lines runtime service that powers other clients.",
    screenshotHint: "Terminal session showing a streamed task, tool activity, and a local model profile.",
    installLabel: "Install with npm",
    installDescription: "Requires Node.js 20 or newer. The same workspace profiles work across the CLI and TUI.",
    commands: ["npm install -g @truss-harness/cli", "truss-cli models", "truss-cli config init", "truss-cli chat \"Review the current diff\""],
    primaryAction: { label: "View CLI docs", href: "/docs/clients/cli" },
    docsHref: "/docs/clients/cli",
    highlights: [
      { title: "Run from anywhere", description: "Start a one-shot task or an ongoing chat directly in the shell you already use." },
      { title: "Find local models", description: "Discover Ollama, LM Studio, llama.cpp, and compatible endpoints before choosing a profile." },
      { title: "Automate safely", description: "Use workspace commands, plans, memory, MCP configuration, and the JSON-lines service without coupling your workflow to a UI." }
    ],
    workflow: ["Discover a server and model with truss-cli models.", "Create a workspace profile with truss-cli config init.", "Run a task, inspect streamed tool activity, and keep the workspace state for the next session."]
  },
  tui: {
    id: "tui",
    eyebrow: "Truss Terminal UI",
    title: "A full coding workspace without leaving the terminal.",
    description: "Use a keyboard-first workspace for files, editor and Git diff inspection, agent chat, tool approvals, and shell output.",
    screenshotHint: "Four-pane terminal workspace with file tree, editor, agent chat, and terminal output.",
    installLabel: "Install with npm",
    installDescription: "Requires Node.js 20 or newer and shares the CLI's local-model profiles and workspace state.",
    commands: ["npm install -g @truss-harness/tui", "truss-tui"],
    primaryAction: { label: "View TUI docs", href: "/docs/clients/tui" },
    docsHref: "/docs/clients/tui",
    highlights: [
      { title: "Four focused panes", description: "Move between files, editor, agent, and terminal panes without breaking the flow of an investigation." },
      { title: "Review before action", description: "Inspect Git diffs and approve or deny model-requested tools in the same workspace." },
      { title: "Keyboard-native control", description: "Search files, open model settings, run workspace commands, and interrupt generation without touching a mouse." }
    ],
    workflow: ["Launch truss-tui from the repository you want to work in.", "Select a detected local endpoint and model if no profile is already configured.", "Attach files, inspect diffs, approve tools, and keep the terminal close to the agent loop."]
  },
  vscode: {
    id: "vscode",
    eyebrow: "Truss for VS Code",
    title: "Local coding agents, right where you edit.",
    description: "Bring streaming chat, context attachments, inline completions, approvals, and Git-aware editor actions into a dedicated VS Code side panel.",
    screenshotHint: "VS Code window with the Truss side panel, a model selector, and a tool approval prompt.",
    installLabel: "Install from the Marketplace",
    installDescription: "Install the Truss extension, open the Activity Bar icon, then select a local server and model from Settings.",
    primaryAction: { label: "Get the VS Code extension", href: "https://marketplace.visualstudio.com/items?itemName=truss-harness.truss-harness-vscode", external: true },
    docsHref: "/docs/clients/vscode",
    highlights: [
      { title: "Editor-aware chat", description: "Attach up to eight workspace files through the composer and preserve useful conversation history in workspace state." },
      { title: "Agent modes and approvals", description: "Switch between Chat, Plan, and Edit while keeping tool permissions explicit and appropriate to the workspace." },
      { title: "Useful editor actions", description: "Accept local-model inline completions and generate a conventional commit message from Git changes without creating the commit for you." }
    ],
    workflow: ["Install Truss from the VS Code Marketplace.", "Open the Truss Activity Bar view and configure a detected endpoint or custom compatible server.", "Choose a model, mode, and tool policy, then use chat and editor actions from the workspace."]
  },
  desktop: {
    id: "desktop",
    eyebrow: "Truss Desktop",
    title: "A dedicated workspace for local coding agents.",
    description: "Open a standalone desktop app for files, Git diffs, terminal work, persistent agent conversations, model controls, and safe tool approvals.",
    screenshotHint: "Three-pane desktop workspace with file tree, diff editor, agent chat, and Git status.",
    installLabel: "Download for your platform",
    installDescription: "Windows installers and Linux AppImage, deb, rpm, and pacman packages are resolved from the latest stable release.",
    primaryAction: { label: "Download desktop", href: "/download" },
    docsHref: "/docs/clients/desktop",
    highlights: [
      { title: "One focused workspace", description: "Browse files, inspect working-tree diffs, run terminal commands, and work with the agent in a single desktop surface." },
      { title: "Git stays visible", description: "Review branch and changed-file state, stage or unstage files, generate a message, commit, pull, and push from the Git panel." },
      { title: "Private by design", description: "The Electron renderer has no Node access; filesystem, terminal, provider, Git, and runtime work cross a narrow IPC bridge." }
    ],
    workflow: ["Download the package for your operating system and architecture.", "Open a workspace and choose a detected local endpoint and model in Settings.", "Attach files, inspect diffs, approve tools, and use the Git and terminal panes alongside the conversation."]
  }
};

export const clientIds = Object.keys(clientContent) as ClientId[];

export function getClientContent(id: string): ClientContent | undefined {
  return clientContent[id as ClientId];
}
