import Link from "next/link";
import { SiteFooter, SiteHeader } from "../site-chrome";
import { createPageMetadata } from "../site-metadata";

const entries = [
  {
    version: "CLI 0.1.12",
    label: "Neovim chat preview",
    changes: [
      "Added a versioned newline-delimited JSON-RPC 2.0 local-service protocol with capability negotiation, bounded inputs, lifecycle events, targeted cancellation, and deterministic shutdown.",
      "Added the first truss.nvim preview with a native streaming split, reusable conversations, current-buffer or visual-selection context, cancellation, and lazy.nvim setup.",
      "Kept the original JSON-lines service shape available for released VS Code clients during migration.",
    ],
  },
  {
    version: "0.1.21",
    label: "Managed MCP connections",
    changes: [
      "Added managed MCP controls in Desktop and VS Code for configuration, enable/disable, isolated connection testing, reconnect, removal, and safe tool inspection.",
      "Added CLI and TUI MCP status surfaces plus read-only gateway protocol v3 visibility in Truss Go without exposing executable configuration or credentials.",
      "Removed stale tools during MCP reconnects and made Desktop recover safely when a session-only Linux provider key expires.",
    ],
  },
  {
    version: "0.1.20",
    label: "Provider connection checks",
    changes: [
      "Added a safe Test connection action in Desktop BYOK settings, plus matching CLI and VS Code commands.",
      "Explained invalid keys, insufficient provider credit, unavailable models, rate limits, and network failures without exposing secrets or provider response bodies.",
      "Kept Desktop keys available for the current app session when Linux encrypted credential storage is unavailable, with a clear session-only disclosure.",
    ],
  },
  {
    version: "0.1.19",
    label: "BYOK provider reliability",
    changes: [
      "Accepted streaming SSE and ordinary JSON responses from OpenAI-compatible BYOK providers, including content-part arrays and complete tool calls.",
      "Stopped sending empty tool definitions in plain Chat mode and replaced silent empty completions with a clear provider-response error.",
    ],
  },
  {
    version: "0.1.18",
    label: "Desktop conversation focus",
    changes: [
      "Kept chat, editor, terminal, and file-action inputs usable after creating, switching, or deleting Desktop conversations on Linux.",
    ],
  },
  {
    version: "0.1.17",
    label: "Multi-agent control center",
    changes: [
      "Added workspace-local agent profiles that can use different local or BYOK providers, endpoints, models, modes, and approval policies.",
      "Added coordinated concurrent Chat and Plan runs, safe queued Edit runs, per-run approvals, stop controls, and recent run details across Desktop, VS Code, the CLI, and host-authorized Truss Go connections.",
      "Added bounded, workspace-local terminal run history and secret-safe runtime lifecycle records for cleanup diagnostics.",
      "Kept completed agent responses available in run details and hardened cancellation, restart, and Linux file-menu behavior.",
    ],
  },
  {
    version: "0.1.16",
    label: "Desktop file actions and website refresh",
    changes: [
      "Made the desktop file-tree context menu reliable on Linux, including repeated use and file or folder creation without closing the app.",
      "Added a clearer Truss Go showcase with real Android screenshots and responsive single-column presentation on phones.",
      "Standardized marketing-page margins, mobile navigation, theme controls, and solid documentation menus across light and dark themes.",
    ],
  },
  {
    version: "0.1.15",
    label: "Runtime reliability",
    changes: [
      "Hardened tool-call parsing so malformed or incomplete model arguments fail clearly and can recover instead of derailing the conversation.",
      "Aligned internal package versions used by release builds.",
      "Refreshed the user-facing README and responsive marketing layouts.",
    ],
  },
  {
    version: "0.1.14",
    label: "Desktop workspace polish",
    changes: [
      "Improved editor keyboard workflows, chat file references, terminal context, tool activity, settings-tab behavior, and workspace pane resizing.",
      "Made desktop themes apply consistently across workspace panels and custom themes.",
      "Ensured Truss-managed development servers stop when the desktop app exits.",
    ],
  },
  {
    version: "0.1.13",
    label: "Linux and settings fixes",
    changes: [
      "Fixed Arch Linux package dependencies and improved Linux launcher icon metadata.",
      "Bundled the formatter required by the desktop Format action.",
      "Reworked settings and resizable workspace sections so all controls remain reachable.",
    ],
  },
  {
    version: "0.1.12",
    label: "Settings in the editor",
    changes: [
      "Moved desktop settings from a popup modal into a normal editor tab.",
      "Reused the existing Settings button to open, focus, or close that tab.",
    ],
  },
  {
    version: "0.1.11",
    label: "Linux release experience",
    changes: [
      "Improved Linux release packaging for Debian, Fedora, Arch, and portable builds.",
      "Added application-wide zoom controls and more flexible desktop workspace sizing.",
      "Polished responsive website layouts and added deployment observability.",
    ],
  },
  {
    version: "0.1.10",
    label: "Desktop agent workflow",
    changes: [
      "Polished the desktop agent workspace, editor, Git, terminal, and approval workflow.",
      "Fixed the download site so it selects the latest desktop release instead of an unrelated tagged release.",
      "Refreshed client versions and shared brand assets.",
    ],
  },
  {
    version: "0.1.9",
    label: "Truss Go stability",
    changes: [
      "Stabilized Truss Go startup, same-Wi-Fi pairing, reconnect behavior, and Android branding.",
      "Improved the mobile conversation, approval, and connection experience.",
    ],
  },
  {
    version: "0.1.8",
    label: "Desktop feedback and editing",
    changes: [
      "Polished the desktop workspace, syntax presentation, agent feedback, and usage metrics.",
    ],
  },
  {
    version: "0.1.7",
    label: "Tool-backed edit reliability",
    changes: [
      "Required edit tasks to complete through verified tool actions and improved release reliability.",
    ],
  },
  {
    version: "0.1.6",
    label: "Workspace persistence",
    changes: [
      "Improved desktop workspace persistence and expanded the public client pages.",
    ],
  },
  {
    version: "0.1.5",
    label: "Providers, themes, and public website",
    changes: [
      "Added BYOK cloud providers alongside local model endpoints.",
      "Added desktop themes and custom theme support.",
      "Expanded the public website, documentation navigation, downloads, roadmap, and client content.",
    ],
  },
  {
    version: "0.1.4",
    label: "Truss Go pairing",
    changes: [
      "Added Truss Go for Android with trusted QR pairing from Desktop and VS Code.",
      "Added mobile workspace streaming, approvals, verified tool outcomes, navigation, and chat attachments.",
      "Kept provider credentials on the host while exposing explicit connection controls.",
    ],
  },
  {
    version: "0.1.3",
    label: "Workspace editing and Git",
    changes: [
      "Expanded desktop workspace editing and Git controls.",
      "Added terminal UI themes and refined the website foundations.",
    ],
  },
  {
    version: "0.1.2",
    label: "Updates and file filtering",
    changes: [
      "Added desktop update support and workspace file filtering.",
      "Improved Windows release packaging and GitHub asset upload reliability.",
      "Added client screenshots to the documentation.",
    ],
  },
  {
    version: "0.1.1",
    label: "Client reliability",
    changes: [
      "Added interactive CLI setup and persistent chat sessions.",
      "Improved Windows executable discovery for CLI and terminal clients.",
      "Bundled the runtime into the VS Code extension and normalized local-provider configuration.",
    ],
  },
  {
    version: "0.1.0",
    label: "Initial public release",
    changes: [
      "Released the shared local-first runtime with provider-neutral tools, persistent workspace state, plans, memory, and approval controls.",
      "Shipped four ways to work: CLI automation, a full-screen terminal UI, a VS Code extension, and the standalone desktop workspace.",
      "Added local-model discovery for Ollama, LM Studio, llama.cpp, and compatible endpoints, plus Git-aware tools and streaming agent events.",
    ],
  },
] as const;

export const metadata = createPageMetadata({
  title: "Changelog",
  description:
    "Product updates for Truss, including its shared runtime, desktop and editor clients, terminal tools, and Truss Go for Android.",
  path: "/changelog",
});

export default function ChangelogPage() {
  return (
    <div className="site">
      <SiteHeader />
      <main className="site-page changelog-page">
        <header className="site-page-intro">
          <p className="site-eyebrow">Changelog</p>
          <h1>What&apos;s new in Truss.</h1>
          <p>
            Follow the runtime, clients, and integrations as they ship. Each
            update moves Truss toward one consistent agent experience across
            your computer, editor, terminal, and phone.
          </p>
        </header>

        <section className="changelog-list" aria-label="Product updates">
          {entries.map((entry) => (
            <article key={entry.version}>
              <header>
                <span>{entry.version}</span>
                <p>{entry.label}</p>
              </header>
              <ul>
                {entry.changes.map((change) => (
                  <li key={change}>{change}</li>
                ))}
              </ul>
            </article>
          ))}
        </section>

        <section className="site-callout">
          <div>
            <p className="site-eyebrow">Available now</p>
            <h2>Try the latest Truss clients.</h2>
          </div>
          <Link className="site-button site-button-primary" href="/download">
            View downloads
          </Link>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
