export type BlogSection = {
  readonly heading: string;
  readonly paragraphs: readonly string[];
  readonly bullets?: readonly string[];
  readonly code?: string;
};

export type BlogFaq = {
  readonly question: string;
  readonly answer: string;
};

export type BlogArticle = {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly excerpt: string;
  readonly publishedAt: string;
  readonly updatedAt: string;
  readonly readingTime: string;
  readonly keywords: readonly string[];
  readonly sections: readonly BlogSection[];
  readonly faqs: readonly BlogFaq[];
};

export const blogArticles = [
  {
    slug: "local-first-coding-agent-guide",
    title: "What Is a Local-First Coding Agent? A Practical Guide",
    description:
      "Learn what a local-first coding agent is, when to use local models or BYOK cloud providers, and how Truss keeps your coding workflow portable across desktop, VS Code, terminal, Neovim, and Android.",
    excerpt:
      "A practical guide to choosing a coding agent you control: local models when privacy and offline work matter, your own provider account when capability matters, and a single runtime across every workspace.",
    publishedAt: "2026-08-29",
    updatedAt: "2026-08-29",
    readingTime: "9 min read",
    keywords: [
      "local-first coding agent",
      "local AI coding assistant",
      "self-hosted coding agent",
      "Ollama coding agent",
      "coding agent CLI",
      "VS Code coding agent",
    ],
    sections: [
      {
        heading: "The short version",
        paragraphs: [
          "A local-first coding agent is an assistant that works with the code on your machine and gives you control over where its model requests go. It can use a model you run locally, such as one served by Ollama, LM Studio, or llama.cpp, or a cloud model through an API key you choose.",
          "Local-first does not mean cloud-hostile. It means the workspace, permissions, and provider choice stay under your control. You can choose a local model for a private repository or an offline session, then switch to a BYOK cloud model when a task needs more reasoning capacity—without adopting a different editor workflow or handing a project to a hosted agent platform.",
        ],
      },
      {
        heading: "Why developers look for local-first agents",
        paragraphs: [
          "Most coding-agent tools are organized around a single vendor, a single editor, or a single hosted service. That can be convenient until the tool does not support the model you need, your network is unreliable, a repository has stricter privacy requirements, or you simply want an assistant in the terminal instead of another browser tab.",
          "A local-first approach separates the parts that should be flexible: the agent runtime, the model provider, the interface, and the tool permissions. The result is less lock-in and a workflow that can fit how you already work.",
        ],
        bullets: [
          "Run with local model servers when you want a private or offline workflow.",
          "Bring your own provider account instead of being forced into one model vendor.",
          "Keep the same workspace behavior in a desktop app, VS Code, terminal UI, CLI, Neovim, or a paired mobile client.",
          "Decide what an agent can read, change, run, or ask permission to do.",
        ],
      },
      {
        heading: "How Truss fits that model",
        paragraphs: [
          "Truss is built around a provider-neutral agent runtime rather than treating an editor extension as the product. The runtime handles agent execution, context, tool calls, permissions, conversation state, and recovery. Its clients provide the surface: a focused desktop workspace, a VS Code panel, a command-line workflow, a terminal UI, Neovim commands, or Truss Go on Android.",
          "That split matters in practice. You do not have to re-learn the same agent workflow every time you change environments. Your model profile and working model stay separate from the editor or terminal you happen to use that day.",
        ],
      },
      {
        heading: "Choose a model setup that matches the work",
        paragraphs: [
          "There is no single best model setup for every repository. A small local model can be great for navigating files, explaining a diff, or drafting a narrow change. A larger cloud model may be worth using for cross-cutting design work, long debugging sessions, or difficult tool use.",
          "Truss lets you configure a local endpoint or a supported BYOK provider profile. Provider credentials are stored on the device through the client’s credential integration; they are not put in a repository configuration file. The active model and its context limit are visible so you can make a deliberate trade-off instead of guessing what the agent is using.",
        ],
        code: "# Start a local model server first, then open Truss\nollama serve\n\n# Use Truss from a terminal workspace\ntruss-harness chat",
      },
      {
        heading: "Control is more than picking a provider",
        paragraphs: [
          "A coding agent becomes useful when it can inspect files, search a project, see a diff, and sometimes make changes or run commands. Those capabilities should not be invisible. In Truss, Chat is for non-mutating questions, Plan is for read-only investigation and planning, and Agent is the mode for approved changes and execution.",
          "The useful question is not just whether an agent is local or cloud-backed. It is whether you can see what it is doing, stop it, set a permission policy, and keep normal Git and terminal workflows in charge. Truss is designed around that boundary.",
        ],
      },
      {
        heading: "A simple way to get started",
        paragraphs: [
          "Start with one client and one model endpoint. If you already work in a terminal, the CLI or terminal UI is the shortest path. If you live in VS Code, install the extension. If you want a dedicated workspace with files, Git, a terminal, preview, and chat in one place, use the desktop app.",
          "Then begin with a read-only question about a real workspace: ask the agent to explain the project structure, inspect a changed file, or summarize a Git diff. Once you trust the context and model, move into planning or an approved agent task.",
        ],
        bullets: [
          "Download the client that matches your workflow.",
          "Connect a local model endpoint or create a BYOK provider profile.",
          "Use Chat or Plan to understand the codebase before making changes.",
          "Use Agent mode only when you want tools and edits under your chosen permission policy.",
        ],
      },
      {
        heading: "What local-first does not promise",
        paragraphs: [
          "A local-first agent is not magic, and it does not make a weak model strong. Local models vary widely in reasoning, coding, context handling, and tool calling. A cloud API can still fail because of an invalid key, unavailable model, rate limit, or account credit. Good software makes those conditions visible instead of pretending every failure is an agent problem.",
          "The point is choice and portability. You can use the model and client that suit the task, keep a reliable fallback, and avoid rebuilding your workflow around a single hosted product.",
        ],
      },
    ],
    faqs: [
      {
        question: "Can a local-first coding agent use cloud models?",
        answer:
          "Yes. Local-first means the workspace and provider choice remain under your control. Truss supports local endpoints and supported BYOK cloud provider profiles, so you can choose either per workflow.",
      },
      {
        question: "Can I use Truss with Ollama?",
        answer:
          "Yes. Start an Ollama server, select or enter its endpoint in Truss, and choose an installed model. Truss also supports LM Studio, llama.cpp servers, and compatible local endpoints.",
      },
      {
        question: "Does Truss require VS Code?",
        answer:
          "No. Truss has a CLI, terminal UI, standalone desktop app, Neovim client, VS Code extension, and a paired Android client. The runtime is designed to be independent from any one interface.",
      },
      {
        question: "Can a coding agent edit or run commands automatically?",
        answer:
          "Only in a mode and permission policy that allow it. Chat and Plan remain non-mutating; Agent mode is where approved workspace tools can make changes or run commands.",
      },
    ],
  },
  {
    slug: "ollama-coding-agent-guide",
    title: "How to Use Ollama as a Local Coding Agent",
    description:
      "A practical Ollama coding-agent setup: connect a local model, choose tasks it can handle well, and use Truss to inspect, plan, and change code with clear permissions.",
    excerpt:
      "Turn an Ollama model into a useful local coding agent without confusing a model server for an agent workflow.",
    publishedAt: "2026-08-20",
    updatedAt: "2026-08-20",
    readingTime: "7 min read",
    keywords: [
      "Ollama coding agent",
      "Ollama coding assistant",
      "local LLM coding",
      "Ollama VS Code",
      "Ollama CLI",
    ],
    sections: [
      {
        heading: "Ollama supplies the model, not the workflow",
        paragraphs: [
          "Ollama makes it straightforward to run a model on your own machine. A coding agent adds the other half of the experience: workspace context, tool calls, an interaction mode, and a clear boundary around what can be changed.",
          "Treat the local server and the agent as separate parts. Start Ollama, select its endpoint in Truss, and then decide whether you want a read-only answer, a plan, or an approved agent task.",
        ],
      },
      {
        heading: "Start with a task a local model can finish",
        paragraphs: [
          "Local coding models are often strongest when the task is concrete: explain a file, find a symbol, summarize a diff, write a focused test, or make a small edit. Give the model a tight goal and let it inspect the relevant workspace context before asking it to act.",
          "Do not judge a model from one oversized request. If it struggles to use tools or loses the thread across a broad change, narrow the task or choose a stronger model for that run.",
        ],
        bullets: [
          "Ask Chat to explain a file or error before changing code.",
          "Use Plan to inspect a feature area and propose steps.",
          "Use Agent only after you understand the task and permission policy.",
        ],
      },
      {
        heading: "Connect Ollama to Truss",
        paragraphs: [
          "Run your Ollama server, open Truss, and choose Local provider. Truss can discover a reachable local model endpoint or accept the endpoint you enter. Pick an installed model and check the context limit shown by the client before starting a long request.",
          "The same connection can be used from the desktop app, the VS Code extension, terminal clients, and other Truss surfaces. That means you can move from an editor session to a terminal workflow without rebuilding the model setup.",
        ],
        code: "ollama serve\nollama pull <your-coding-model>\ntruss-harness chat",
      },
      {
        heading: "Know the trade-offs",
        paragraphs: [
          "A local model avoids per-request cloud billing and can keep model inference on your machine. In return, quality and speed depend on your hardware, model size, quantization, context, and whether the selected model reliably supports tool calls.",
          "Keep a BYOK cloud profile available for difficult multi-file work. Local-first is valuable because you can choose that escalation deliberately, rather than replacing your entire coding workflow when one task needs more capability.",
        ],
      },
    ],
    faqs: [
      {
        question: "Can Ollama edit files through Truss?",
        answer:
          "Yes, when you use Agent mode and a permission policy that permits the relevant tools. Chat and Plan remain read-only.",
      },
      {
        question: "Why does an Ollama model answer but not use tools?",
        answer:
          "Tool use depends on the model and server behavior, not only the client. Try a model known to support tool calling, reduce task scope, or use a BYOK model for that task.",
      },
    ],
  },
  {
    slug: "self-hosted-coding-assistant-private-repos",
    title: "A Self-Hosted Coding Assistant for Private Repositories",
    description:
      "How to evaluate a self-hosted coding assistant for private repositories: local inference, workspace boundaries, credentials, permissions, and practical fallback options.",
    excerpt:
      "Private code needs more than a local model checkbox. Build a workflow around visible context, controlled tools, and an intentional cloud fallback.",
    publishedAt: "2026-08-12",
    updatedAt: "2026-08-12",
    readingTime: "8 min read",
    keywords: [
      "self-hosted coding assistant",
      "private repository AI",
      "private AI coding assistant",
      "offline coding agent",
      "local code assistant",
    ],
    sections: [
      {
        heading: "Define what private means for your team",
        paragraphs: [
          "A self-hosted coding assistant can keep model inference local, but privacy depends on the full path: which files enter context, where tool output goes, whether a cloud provider is selected, and how credentials are stored.",
          "Start by deciding which repositories must remain offline and which can use a provider account. A good setup makes that choice visible at the workspace level instead of burying it inside an extension setting.",
        ],
      },
      {
        heading: "Keep context narrow and observable",
        paragraphs: [
          "An agent does not need every file in a repository to answer a useful question. Begin with the current file, a diff, a directory listing, or a targeted search. This improves relevance and reduces unnecessary exposure even in a local workflow.",
          "Truss keeps the agent’s workspace tools explicit. You can see tool activity, use read-only modes for investigation, and reserve mutation for a mode and policy you selected.",
        ],
        bullets: [
          "Use Chat for a non-mutating codebase question.",
          "Use Plan for read-only investigation and a proposed approach.",
          "Review tool activity and Git changes before treating a task as complete.",
        ],
      },
      {
        heading: "Separate credentials from repository configuration",
        paragraphs: [
          "Never put a provider key into a committed project file just to make a coding assistant work. Truss keeps provider profiles and credentials in client-side credential storage or environment-based setup, not in workspace source control.",
          "That distinction also makes it safer to share a repository configuration with teammates: the repo can describe the project while each developer chooses a local model or their own provider account.",
        ],
        code: '# Keep provider credentials outside the repository\nexport OPENROUTER_API_KEY="..."\ntruss-harness chat --profile cloud',
      },
      {
        heading: "Use a planned fallback, not a surprise one",
        paragraphs: [
          "Some tasks will exceed a local model’s capabilities. That does not mean a self-hosted workflow failed. It means your policy should identify when a task can move to an approved BYOK provider and what context is acceptable to send.",
          "The durable win is control: local for the work that belongs local, an approved cloud profile for the work that needs it, and the same tool and permission model in both cases.",
        ],
      },
    ],
    faqs: [
      {
        question:
          "Does a local model guarantee that no code leaves my machine?",
        answer:
          "It can keep inference local, but you should also verify the active provider, connected tools, and any networked services in the workflow. Local-first is a design choice you should confirm per workspace.",
      },
      {
        question: "Can I use Truss without an API key?",
        answer:
          "Yes. A local endpoint such as Ollama, LM Studio, or llama.cpp does not require a cloud provider API key.",
      },
    ],
  },
  {
    slug: "byok-coding-agent-guide",
    title: "BYOK Coding Agents: Use Your Own Model Provider Account",
    description:
      "A clear guide to bring-your-own-key coding agents: why BYOK matters, how provider profiles work, how to test a connection, and how to avoid common API errors.",
    excerpt:
      "Use the model provider account you already trust, keep keys out of repositories, and make provider failures understandable.",
    publishedAt: "2026-08-04",
    updatedAt: "2026-08-04",
    readingTime: "7 min read",
    keywords: [
      "BYOK coding agent",
      "bring your own key AI coding",
      "API key coding assistant",
      "OpenRouter coding agent",
      "cloud coding agent",
    ],
    sections: [
      {
        heading: "BYOK means your account, your model choice",
        paragraphs: [
          "A BYOK coding agent connects to a provider account you control rather than reselling one bundled model plan. You choose the provider, model ID, account limits, and billing relationship; the agent client supplies the workspace workflow.",
          "That is useful when different models fit different jobs. You may prefer one provider for tool-heavy agent tasks, another for a specialized model, and a local server for private work.",
        ],
      },
      {
        heading: "Use a named provider profile",
        paragraphs: [
          "Do not overwrite one global key whenever you switch models. Create a named profile for each provider account, record the endpoint and model ID, and keep the credential in the client’s secure storage or in an environment variable outside the repository.",
          "Truss lets you choose a provider profile rather than turning model choice into a permanent app-wide decision. This makes it easier to test a new model without losing a working configuration.",
        ],
        bullets: [
          "Enter the provider endpoint and exact model ID.",
          "Save or set the key outside the workspace.",
          "Use Test connection before relying on the profile for an agent run.",
          "Keep a local profile as a fallback when appropriate.",
        ],
      },
      {
        heading: "Read failures as provider signals",
        paragraphs: [
          "A 401 generally means the provider rejected the credential. A 402 can mean billing or credits are required. A rate-limit response means the key is recognized but temporarily unable to serve the request. A model-not-found response usually means the model ID or provider route is wrong.",
          "Those errors are not interchangeable. Test the connection with the exact profile, confirm the provider account has access to the selected model, and use the provider’s own dashboard for account or credit status.",
        ],
      },
      {
        heading: "Keep the key separate from source code",
        paragraphs: [
          "Treat a provider key like any other credential. Do not paste it into a prompt, commit it to `.env` without ignoring that file, or include it in a workspace setting you plan to share. Rotate a key immediately if it appears in a public issue, screenshot, or commit.",
          "The right outcome is a portable project and private credentials: anyone can clone the workspace, while each developer selects their own account profile.",
        ],
      },
    ],
    faqs: [
      {
        question: "Do I need credits to use a paid BYOK model?",
        answer:
          "Usually yes. A valid key can still receive a billing, credit, or rate-limit response if the account cannot use that model at that time.",
      },
      {
        question: "Can I switch back to a local model after using BYOK?",
        answer:
          "Yes. Provider selection is separate from the workspace and client surface, so you can choose a local profile for the next run.",
      },
    ],
  },
  {
    slug: "local-ai-coding-assistant-vscode",
    title: "How to Use a Local AI Coding Assistant in VS Code",
    description:
      "Set up a local or BYOK coding assistant in VS Code with Truss, then use read-only chat, planning, agent tools, and model profiles without leaving your editor.",
    excerpt:
      "A practical VS Code workflow for developers who want a local model or their own API provider—not a locked-in assistant plan.",
    publishedAt: "2026-07-27",
    updatedAt: "2026-07-27",
    readingTime: "6 min read",
    keywords: [
      "local AI coding assistant VS Code",
      "Ollama VS Code coding agent",
      "VS Code coding agent",
      "BYOK VS Code extension",
      "local LLM VS Code",
    ],
    sections: [
      {
        heading: "Keep the agent inside the editor you already use",
        paragraphs: [
          "A VS Code coding assistant should add useful project context without forcing you into a separate editor or hosted workspace. Truss runs as an extension surface over the same provider-neutral runtime used by its other clients.",
          "That means your model can be local or BYOK, while the interaction stays close to the open file, active workspace, Git changes, and editor workflow.",
        ],
      },
      {
        heading: "Start in Chat or Plan before Agent",
        paragraphs: [
          "Use Chat for questions like ‘what does this module do?’ or ‘where is this value created?’ It can inspect safe workspace context without making a change. Use Plan when you want a read-only investigation followed by proposed implementation steps.",
          "When you are ready to make a change, switch to Agent and choose the tool permission policy intentionally. This sequence creates a more reliable review loop than asking every conversation to be autonomous.",
        ],
      },
      {
        heading: "Configure the model once, then choose it deliberately",
        paragraphs: [
          "In Truss settings, connect a local endpoint or create a named cloud provider account. Use Discover models where the provider supports it, verify the exact model, and run a connection test before assuming an agent failure is a code problem.",
          "The extension exposes the active model and context information so you can check the foundation of a response. If a small local model stalls on tool use, change the model or narrow the task rather than repeatedly sending the same prompt.",
        ],
      },
      {
        heading: "Use VS Code as a review surface",
        paragraphs: [
          "The best agent workflow does not replace your editor’s normal strengths. Keep source control visible, inspect generated diffs, and use the regular terminal for commands that deserve your full attention.",
          "Truss is meant to fit that loop: ask, inspect context, review proposed work, allow only the tools you want, and validate the result using the same editor and Git tooling you already trust.",
        ],
      },
    ],
    faqs: [
      {
        question: "Can Truss for VS Code use Ollama?",
        answer:
          "Yes. Configure a reachable local endpoint, select an installed model, and use it from the extension.",
      },
      {
        question: "How do I install the VS Code extension?",
        answer:
          "Download the signed VSIX from the current Truss GitHub Release, then use Extensions: Install from VSIX in VS Code.",
      },
    ],
  },
  {
    slug: "terminal-coding-agent-cli-tui",
    title: "Terminal Coding Agents: CLI vs TUI Workflows",
    description:
      "Choose the right terminal coding-agent workflow: a scriptable CLI for automation, a full terminal UI for interactive work, and the same local or BYOK model profiles behind both.",
    excerpt:
      "Use a coding agent from the shell without trading away the terminal, Git, or local models that make your workflow yours.",
    publishedAt: "2026-07-19",
    updatedAt: "2026-07-19",
    readingTime: "6 min read",
    keywords: [
      "terminal coding agent",
      "coding agent CLI",
      "AI coding assistant terminal",
      "terminal UI coding agent",
      "local CLI coding assistant",
    ],
    sections: [
      {
        heading: "Why terminal-native agents still matter",
        paragraphs: [
          "A terminal coding agent is useful when the shell is already the center of your work: remote machines, Git-heavy projects, scripts, SSH sessions, and fast project navigation. It should work with the files and commands you already use instead of duplicating them in a web dashboard.",
          "Truss offers both a CLI and a terminal UI. They share the runtime model and provider configuration, but they serve different kinds of work.",
        ],
      },
      {
        heading: "Use the CLI for repeatable commands",
        paragraphs: [
          "The CLI is the better fit when you want a small surface area, shell composition, or automation. You can configure a profile, ask a scoped question, and integrate a command into an existing script or terminal habit.",
          "Keep automation narrow and observable. An agent command can help with a focused review or generation task, but your CI, tests, and deployment process should remain explicit rather than becoming an opaque prompt.",
        ],
      },
      {
        heading: "Use the TUI for interactive workspace work",
        paragraphs: [
          "A terminal UI is better when you want files, Git status, agent chat, terminal output, and model controls together while staying keyboard-first. It gives you more workspace visibility without requiring a graphical editor.",
          "The TUI is especially useful on machines where a desktop client is not practical but a browser-only agent would feel disconnected from the repository.",
        ],
      },
      {
        heading: "Keep the same profile across surfaces",
        paragraphs: [
          "The important part is not choosing CLI or TUI forever. It is keeping a stable provider and permission model. You can configure a local endpoint for one session, choose a BYOK model for another, and move between terminal and editor clients without a separate agent personality for every surface.",
          "Start from the simplest surface that matches the task. When the task grows, move to the client that gives you better context and review controls—not a different vendor.",
        ],
      },
    ],
    faqs: [
      {
        question: "Can I use a local model from the Truss CLI?",
        answer:
          "Yes. Configure a local endpoint profile and use it from the CLI or TUI.",
      },
      {
        question: "Is a terminal coding agent only for Linux?",
        answer:
          "No. Terminal workflows are useful anywhere you have a supported shell and can run the Truss CLI.",
      },
    ],
  },
  {
    slug: "coding-agent-permissions-safe-workflow",
    title: "Coding Agent Permissions: A Safer Workflow for Real Repositories",
    description:
      "Learn how to set coding-agent permissions without slowing down: read-only investigation, planning, scoped editing, terminal approvals, and Git-based verification.",
    excerpt:
      "The useful safety boundary is not ‘always allow’ or ‘never allow.’ It is choosing the smallest capability that fits the current task.",
    publishedAt: "2026-07-11",
    updatedAt: "2026-07-11",
    readingTime: "7 min read",
    keywords: [
      "coding agent permissions",
      "safe AI coding agent",
      "AI agent tool permissions",
      "coding agent approval workflow",
      "agentic coding safety",
    ],
    sections: [
      {
        heading: "Start with the least powerful mode",
        paragraphs: [
          "A coding agent does not need write access to explain a file, search for a symbol, or summarize a diff. Start in a read-only mode whenever the real task is understanding the codebase.",
          "Truss separates Chat, Plan, and Agent for that reason. Chat is non-mutating conversation, Plan is read-only investigation and task planning, and Agent is the mode where workspace tools can act according to your permission policy.",
        ],
      },
      {
        heading: "Treat terminal access differently from file context",
        paragraphs: [
          "Reading a source file and running a shell command are not the same risk. A command can change files, contact a network service, alter a repository, or consume resources. Keep terminal execution visible and approve it at the right level for the work.",
          "A useful policy is specific rather than dramatic: allow safe inspection commands for a session, ask before commands that mutate the workspace, and preserve a human checkpoint before actions that affect remote systems.",
        ],
      },
      {
        heading: "Make Git the final review layer",
        paragraphs: [
          "Even a well-configured agent can misunderstand a request. Git gives you an independent way to inspect the result. Review changed files, read the diff, run tests, and commit only after the work satisfies the project’s normal standards.",
          "That is not redundant process. It turns agent work into ordinary software work with a faster first draft, instead of trusting a model to declare its own result correct.",
        ],
      },
      {
        heading: "Use context and permissions together",
        paragraphs: [
          "Bad context can make a safe agent unhelpful, while broad permissions can make a capable agent risky. Keep the task focused, ask the agent to inspect relevant code first, and grant only the tools it needs for the next step.",
          "The goal is not to eliminate agent autonomy. It is to make autonomy legible: you should know what the agent can do, what it did, and how to stop or review it.",
        ],
      },
    ],
    faqs: [
      {
        question: "Can Chat mode change my files?",
        answer:
          "No. Chat is designed for non-mutating codebase questions. Use Agent only when you intend to allow workspace tools.",
      },
      {
        question: "Should I allow every tool for every task?",
        answer:
          "No. Use the smallest permission scope that can complete the task, and raise it only when the task genuinely needs more capability.",
      },
    ],
  },
  {
    slug: "mcp-for-coding-agents-guide",
    title: "MCP for Coding Agents: Connect Tools Without Losing Control",
    description:
      "Understand Model Context Protocol (MCP) for coding agents: what an MCP server adds, how to configure it, and how to keep external tools within a clear permission boundary.",
    excerpt:
      "MCP can extend a coding agent beyond files and terminal commands. The important part is choosing and governing every added tool.",
    publishedAt: "2026-07-03",
    updatedAt: "2026-07-03",
    readingTime: "7 min read",
    keywords: [
      "MCP coding agent",
      "Model Context Protocol coding assistant",
      "MCP server developer tools",
      "coding agent integrations",
      "MCP permissions",
    ],
    sections: [
      {
        heading: "What MCP changes",
        paragraphs: [
          "Model Context Protocol gives an agent a standard way to discover and call additional tools. In a coding workflow, that might mean a project-specific service, a documentation source, a database helper, or a read-only integration that provides useful context.",
          "It is an extension mechanism, not a reason to give every agent every capability. Each server adds a new trust boundary and should be configured as deliberately as a dependency or credential.",
        ],
      },
      {
        heading: "Start with one useful, narrow server",
        paragraphs: [
          "Choose an MCP server because it solves a real context gap—not because it is available. A read-only documentation or filesystem helper is easier to evaluate than a broad server with remote write access.",
          "Configure it in the client, understand the command it runs and the tools it exposes, then test a small task before relying on it in an agent workflow.",
        ],
      },
      {
        heading: "Match MCP access to the interaction mode",
        paragraphs: [
          "Truss keeps Chat and Plan non-mutating. Read-only MCP tools can support those modes when they are explicitly marked and appropriate; mutation-capable tools belong behind Agent mode and its permissions.",
          "This keeps a normal codebase question from quietly expanding into external side effects. It also makes it easier to explain why an agent did or did not have access to a service.",
        ],
      },
      {
        heading: "Review MCP like any other integration",
        paragraphs: [
          "An MCP configuration can run a command and expose data or actions to an agent. Keep server definitions reviewable, avoid placing secrets in shared config, and remove integrations you no longer need.",
          "For sensitive services, use least-privilege accounts and treat the agent’s tool transcript as part of the engineering record. The extension should make workflows clearer, not hide the path from prompt to action.",
        ],
      },
    ],
    faqs: [
      {
        question: "Does MCP give an agent unlimited access?",
        answer:
          "No. MCP only provides the tools a configured server exposes, and Truss still applies interaction-mode and permission boundaries.",
      },
      {
        question: "Can I use MCP in read-only codebase chat?",
        answer:
          "Yes, when the MCP server and its tools are explicitly read-only and suitable for Chat or Plan.",
      },
    ],
  },
  {
    slug: "local-ai-coding-workflow-linux",
    title: "Build a Local AI Coding Workflow on Linux",
    description:
      "Set up a practical local AI coding workflow on Linux with a model server, Truss, your terminal, VS Code or Neovim, and a deliberate approach to model performance.",
    excerpt:
      "A Linux-first coding-agent setup that starts simple, works in the terminal, and can grow into desktop or editor workflows without replacing your tools.",
    publishedAt: "2026-06-25",
    updatedAt: "2026-06-25",
    readingTime: "8 min read",
    keywords: [
      "local AI coding Linux",
      "Linux coding agent",
      "Ollama Linux coding assistant",
      "self-hosted AI developer tools",
      "Neovim coding agent",
    ],
    sections: [
      {
        heading: "Start with the tools Linux already makes comfortable",
        paragraphs: [
          "Linux is a natural place to try a local coding workflow because the terminal, package tools, SSH, Git, and editor customization are already part of the environment. The best first setup is still a small one: one local model endpoint, one Truss client, and one real repository.",
          "Do not begin by installing every model and integration. Get one model responding reliably, then add the client surface that matches how you work.",
        ],
      },
      {
        heading: "Choose your primary surface",
        paragraphs: [
          "Use the CLI for direct shell work and scripts. Use the TUI when you want a keyboard-first workspace with file and Git visibility. Use the desktop app for a dedicated editor, terminal, preview, and chat workspace. Use VS Code or Neovim when the editor is already home.",
          "All of those surfaces can connect to the same local or BYOK provider profile. Pick one first; portability is there when you need it, not as a setup requirement.",
        ],
      },
      {
        heading: "Budget for model performance",
        paragraphs: [
          "Local model quality depends on available memory, GPU support, model size, quantization, and context length. A smaller model may be fast enough for repo navigation and focused edits but not reliable for complex tool use. Benchmark it with real tasks from a disposable workspace.",
          "When a task needs more than the local model can provide, a BYOK profile gives you an intentional escalation path. That is better than silently sending every request to a cloud service.",
        ],
      },
      {
        heading: "Keep the normal developer loop intact",
        paragraphs: [
          "Your coding agent should fit beside standard Linux tooling: inspect diffs, run the project’s actual test commands, use Git branches, and keep credentials out of the repository. The agent can accelerate the loop, but it should not hide it.",
          "Start with read-only prompts, build trust in the model and context, then graduate to scoped Agent tasks. That makes a local workflow practical instead of merely impressive in a demo.",
        ],
      },
    ],
    faqs: [
      {
        question: "Does Truss work on Arch, Debian, or Fedora?",
        answer:
          "Truss provides Linux desktop packages and terminal-based clients. Choose the download package that matches your distribution, or use the documented CLI/TUI path.",
      },
      {
        question: "Can I use Truss with Neovim on Linux?",
        answer:
          "Yes. The Truss Neovim client can use the same configured runtime and provider profile as your other workflows.",
      },
    ],
  },
  {
    slug: "choose-a-coding-agent-for-your-workflow",
    title: "How to Choose a Coding Agent Without Replacing Your Workflow",
    description:
      "A developer-focused framework for choosing a coding agent: model flexibility, local support, tool permissions, client surfaces, context quality, and how the agent fits Git and tests.",
    excerpt:
      "The best coding agent is not the one with the loudest demo. It is the one that fits your model, workspace, permission, and review requirements.",
    publishedAt: "2026-06-17",
    updatedAt: "2026-06-17",
    readingTime: "8 min read",
    keywords: [
      "how to choose a coding agent",
      "best coding agent workflow",
      "coding agent comparison criteria",
      "local first developer tools",
      "AI coding assistant guide",
    ],
    sections: [
      {
        heading: "Start with the workflow, not the model leaderboard",
        paragraphs: [
          "A coding agent can look exceptional in a benchmark and still be a poor fit if it only works in one editor, requires one provider account, or hides the context and tools it uses. Start by describing the work you want help with: codebase questions, planned changes, repetitive edits, reviews, or terminal-driven tasks.",
          "Then choose an interface and permission model that support those tasks without forcing you to abandon Git, tests, or the editor you already know.",
        ],
      },
      {
        heading: "Ask five practical questions",
        paragraphs: [
          "Can you choose local and cloud models? Can you see and control what tools the agent can use? Can it work where you work—editor, terminal, desktop, or Neovim? Does it make context and errors visible? Can you keep your existing review and test process?",
          "A tool that answers those questions well will usually remain useful as models and provider prices change. A tool that answers only one may be convenient now but expensive to leave later.",
        ],
        bullets: [
          "Provider flexibility",
          "Local and offline capability",
          "Permission and approval controls",
          "Client portability",
          "Transparent context, diffs, and errors",
        ],
      },
      {
        heading: "Separate exploration from execution",
        paragraphs: [
          "You should be able to ask codebase questions without allowing file writes or terminal commands. You should also be able to move into a planned execution mode when a task deserves it. That separation makes an agent easier to trust and easier to correct.",
          "Truss encodes that distinction with Chat, Plan, and Agent rather than treating every prompt as an autonomous request.",
        ],
      },
      {
        heading: "Optimize for a durable setup",
        paragraphs: [
          "Model providers, editor preferences, and project requirements all change. A durable coding-agent setup keeps those layers replaceable. It lets you use a local endpoint one week, a provider profile the next, and a different client without rebuilding the workflow.",
          "That is the core of Truss: one runtime, multiple clients, provider choice, and explicit tool boundaries. It is designed to work with your development practice, not to become a walled garden around it.",
        ],
      },
    ],
    faqs: [
      {
        question: "Should I choose a local or cloud coding agent?",
        answer:
          "Choose based on the task. Local models can be private and offline; cloud BYOK models may offer more capability. A flexible setup lets you use both.",
      },
      {
        question: "What matters more: autocomplete or agent tools?",
        answer:
          "They solve different jobs. An agent is most valuable when it can understand a task, inspect relevant context, and work within a clear permission and review workflow.",
      },
    ],
  },
  {
    slug: "coding-agent-context-and-git-diffs",
    title: "Give a Coding Agent Better Context: Files, Diffs, and Plans",
    description:
      "Learn how to give a coding agent useful context without dumping an entire repository into a prompt: start from files, Git diffs, targeted search, and read-only plans.",
    excerpt:
      "Better agent results come from relevant context and a clear task—not from pasting the entire repository into a chat box.",
    publishedAt: "2026-06-09",
    updatedAt: "2026-06-09",
    readingTime: "6 min read",
    keywords: [
      "coding agent context",
      "AI codebase context",
      "coding agent git diff",
      "AI coding plan",
      "agent code review workflow",
    ],
    sections: [
      {
        heading: "Context is a selection problem",
        paragraphs: [
          "A repository can contain thousands of files, but most coding tasks begin with a small, relevant set: the open file, an error, a related symbol, a Git diff, or a specific directory. Sending everything creates noise and can exceed the model’s useful context budget.",
          "Start with the smallest context that can answer the question, then let the agent search or read additional files when the evidence requires it.",
        ],
      },
      {
        heading: "Use Git to explain what changed",
        paragraphs: [
          "A Git diff is one of the highest-value context sources available. It shows the actual change, the nearby implementation, and the review question. Ask an agent to summarize a diff, identify a likely regression, or suggest tests before asking it to produce more code.",
          "This works especially well in Truss because Git status and diff views live beside the agent workflow rather than as an afterthought.",
        ],
      },
      {
        heading: "Plan before you edit",
        paragraphs: [
          "A read-only plan forces the agent to inspect the codebase and explain its intended steps. It gives you a chance to correct an assumption before a file changes, which is faster than undoing an agent that solved the wrong problem.",
          "Use Plan for cross-file features, unfamiliar repositories, migrations, and bugs where the first challenge is understanding the system rather than typing code.",
        ],
      },
      {
        heading: "Keep the request testable",
        paragraphs: [
          "Good prompts identify the outcome, constraints, and validation method. Instead of ‘fix the auth flow,’ name the failing route, expected behavior, relevant error, and test command. The agent gets better guidance, and you get a clearer definition of done.",
          "After a change, inspect the diff and run the project’s tests. Context improves the first draft; verification is what makes the change reliable.",
        ],
      },
    ],
    faqs: [
      {
        question:
          "Should I paste an entire repository into an AI coding assistant?",
        answer:
          "Usually no. Start with focused context and let the agent inspect relevant files through read-only workspace tools.",
      },
      {
        question: "Why use Plan mode before Agent mode?",
        answer:
          "It lets you validate the agent’s understanding and proposed approach before granting editing or command execution capabilities.",
      },
    ],
  },
  {
    slug: "what-is-an-agent-harness",
    title: "What Is an Agent Harness? The Runtime Behind an AI Agent",
    description:
      "An agent harness connects a model to context, tools, permissions, state, and an interface. Learn what it does and why it matters for coding agents.",
    excerpt:
      "A model can answer questions. An agent harness gives it a controlled way to understand a workspace, use tools, and recover from real work.",
    publishedAt: "2026-08-28",
    updatedAt: "2026-08-28",
    readingTime: "7 min read",
    keywords: [
      "agent harness",
      "AI agent harness",
      "coding agent runtime",
      "agent framework",
    ],
    sections: [
      {
        heading: "An agent harness is the operating layer around a model",
        paragraphs: [
          "An agent harness is the software that turns a language model into a useful agent. It selects context, exposes tools, applies permission rules, keeps a session, streams progress, and turns tool results back into the next model step. The model supplies reasoning; the harness supplies the working environment.",
          "For a coding agent, that environment includes a repository, Git state, files, diagnostics, and commands. Without a harness, a model can suggest a patch. With one, it can inspect the relevant code, explain its plan, request the right capability, and leave an auditable trail of what happened.",
        ],
      },
      {
        heading: "What a useful harness owns",
        paragraphs: [
          "A practical harness owns the parts that should behave consistently no matter which model or user interface is active. That includes provider configuration, context selection, tool contracts, session recovery, approval policy, and interruption handling.",
        ],
        bullets: [
          "Provider routing and credentials",
          "Workspace context and memory",
          "Read, write, search, Git, and terminal tools",
          "Permission checks and approval requests",
          "Streaming events, cancellation, and session state",
        ],
      },
      {
        heading: "Why the distinction matters",
        paragraphs: [
          "When the harness is separate from the editor, model, or hosted service, developers keep more options. You can move from a terminal workflow to a desktop workspace, select a different provider for a difficult task, or add a new tool without rebuilding the agent around a single surface.",
          "Truss is built around this separation. Its clients provide the experience while the shared runtime keeps the agent loop, tools, context, and permission boundaries consistent.",
        ],
      },
    ],
    faqs: [
      {
        question: "Is an agent harness the same as an LLM framework?",
        answer:
          "Not exactly. An LLM framework may help call models or compose prompts. An agent harness adds the operational layer: tools, context, permissions, sessions, streaming, and recovery.",
      },
      {
        question: "Do coding agents need an agent harness?",
        answer:
          "A simple chat assistant does not. A coding agent that needs to inspect a workspace, call tools, manage approvals, and resume work benefits from a dedicated harness.",
      },
    ],
  },
  {
    slug: "coding-agent-runtime-explained",
    title:
      "Coding Agent Runtime: What It Is and Why It Should Outlive the Editor",
    description:
      "Learn what a coding-agent runtime does, how it differs from an IDE extension, and why a shared runtime creates a more durable AI development workflow.",
    excerpt:
      "Your editor is where you work. A coding-agent runtime is the layer that makes agent behavior, tools, and safety policies portable.",
    publishedAt: "2026-08-27",
    updatedAt: "2026-08-27",
    readingTime: "6 min read",
    keywords: [
      "coding agent runtime",
      "AI agent runtime",
      "agent runtime architecture",
      "IDE coding agent",
    ],
    sections: [
      {
        heading: "The runtime is the agent, not the panel around it",
        paragraphs: [
          "A coding-agent runtime coordinates model calls, context, tool execution, state, and error recovery. An IDE extension, desktop app, or terminal UI presents that runtime to a developer. Treating those layers separately keeps the core agent behavior from being trapped inside one interface.",
          "That distinction shows up when a workflow changes. The same task may begin in a terminal, continue in an editor, and be reviewed in a desktop app. A runtime can keep the model profile, permission policy, plan, and workspace state coherent across those surfaces.",
        ],
      },
      {
        heading: "What belongs in a runtime",
        paragraphs: [
          "The runtime should know how to build a request, run a tool, enforce a policy, persist a session, and report events. It should not need to know which button opened a panel or how a particular editor renders a diff.",
        ],
        bullets: [
          "Model and provider adapters",
          "Agent modes and permission policy",
          "Context, memory, checkpoints, and recovery",
          "Tool schemas and execution results",
          "Streaming, cancellation, and structured events",
        ],
      },
      {
        heading: "A portable runtime reduces rebuild work",
        paragraphs: [
          "A shared runtime lets a client gain improvements in agent behavior without each client inventing a separate tool loop. It also makes testing clearer because the behavior can be verified independently from the UI.",
          "Truss uses this pattern so its desktop app, VS Code extension, CLI, terminal UI, Neovim client, and mobile companion can share the same agent foundation while remaining focused interfaces.",
        ],
      },
    ],
    faqs: [
      {
        question: "Is a coding-agent runtime a server?",
        answer:
          "It can run locally inside a client, behind a local service, or remotely. The important part is that it owns agent behavior independently from the interface.",
      },
      {
        question: "Why not put all agent logic in an IDE extension?",
        answer:
          "It makes the agent harder to reuse, test, and evolve outside that editor. A runtime lets clients stay focused on UX while sharing reliable agent behavior.",
      },
    ],
  },
  {
    slug: "ai-agent-tool-calling-explained",
    title:
      "AI Agent Tool Calling: How Coding Agents Read, Search, and Change Code",
    description:
      "Understand AI agent tool calling, from structured tool requests to permission checks, results, retries, and developer review in a coding workflow.",
    excerpt:
      "Tool calling is how an agent stops guessing about a repository and starts gathering evidence, under rules you can inspect.",
    publishedAt: "2026-08-26",
    updatedAt: "2026-08-26",
    readingTime: "7 min read",
    keywords: [
      "AI agent tool calling",
      "coding agent tools",
      "LLM tool use",
      "agent function calling",
    ],
    sections: [
      {
        heading: "Tool calling gives an agent evidence",
        paragraphs: [
          "Tool calling is a structured request from a model to software that can perform a specific action. For coding work, that might be reading a file, listing a directory, searching for a symbol, checking a Git diff, or running a test command.",
          "The model does not execute arbitrary code by itself. It proposes a tool name and arguments. The harness validates that request, checks policy, runs the implementation if permitted, and returns a result the model can use for its next step.",
        ],
      },
      {
        heading: "Good tool design keeps boundaries explicit",
        paragraphs: [
          "Each tool should have a clear schema, a narrow description, and a predictable result. Read-only tools are useful for Chat and planning. Mutating tools, such as file writes and terminal commands, need stronger policy checks because they can change a workspace.",
        ],
        bullets: [
          "Validate arguments before execution.",
          "Separate read-only and mutating capabilities.",
          "Show requested actions and results in the activity stream.",
          "Stop or retry safely when a tool fails.",
        ],
      },
      {
        heading: "The developer remains part of the loop",
        paragraphs: [
          "Useful tool calling is not invisible automation. It should show what was read, searched, changed, or run, then preserve the normal review process with diffs and tests. That gives an agent enough evidence to help without turning the workspace into a black box.",
          "Truss exposes tool activity and keeps Chat and Plan non-mutating. Agent mode is where permitted workspace changes and commands can happen under the selected policy.",
        ],
      },
    ],
    faqs: [
      {
        question: "Is tool calling the same as function calling?",
        answer:
          "They are closely related. Function calling usually describes the structured model output; tool calling includes validation, policy, execution, results, and the next agent step.",
      },
      {
        question: "Can tool calling make a coding agent safer?",
        answer:
          "Yes, when tools are narrow, arguments are validated, sensitive actions require approval, and the user can see what the agent requested and what happened.",
      },
    ],
  },
  {
    slug: "coding-agent-observability",
    title: "Coding Agent Observability: See Context, Tool Calls, and Outcomes",
    description:
      "A practical introduction to coding-agent observability: what to inspect before, during, and after an agent run so debugging and review stay possible.",
    excerpt:
      "If you cannot see an agent's context, tool activity, and result, you cannot confidently debug or review its work.",
    publishedAt: "2026-08-25",
    updatedAt: "2026-08-25",
    readingTime: "6 min read",
    keywords: [
      "coding agent observability",
      "AI agent monitoring",
      "agent tool call logs",
      "agent debugging",
    ],
    sections: [
      {
        heading: "An agent needs an activity trail",
        paragraphs: [
          "A coding agent makes a sequence of decisions: what context to inspect, which tool to request, how to interpret the result, and whether a change is complete. Observability makes that sequence visible enough for a developer to review and correct.",
          "The goal is not to expose every hidden model thought. The useful record is operational: active provider and model, selected mode, context sources, tool requests, tool results, errors, cancellation, changed files, and validation output.",
        ],
      },
      {
        heading: "What to inspect when a run goes wrong",
        paragraphs: [
          "Start with the concrete failure. Did the provider reject a key, rate-limit a request, return malformed tool arguments, or lose the relevant file context? Those are different problems and they need different fixes. A generic 'agent failed' message hides the evidence needed to solve any of them.",
        ],
        bullets: [
          "Confirm the selected provider, model, and account.",
          "Inspect the tool that failed and its validated arguments.",
          "Check the returned error before retrying.",
          "Review the diff and validation results after a write.",
        ],
      },
      {
        heading: "Visibility improves trust and iteration",
        paragraphs: [
          "When tool activity is visible, developers can interrupt a bad path early, tighten the task, or switch to a more appropriate model. It also makes a successful run easier to reproduce because the important actions are not hidden behind one final message.",
          "Truss shows tool activity alongside conversations and keeps Git-aware review close to the working session, so an agent run can be treated like normal engineering work rather than a mysterious output generator.",
        ],
      },
    ],
    faqs: [
      {
        question: "What is agent observability?",
        answer:
          "It is the ability to inspect the operational behavior of an agent, including context selection, tool requests, results, failures, and final changes.",
      },
      {
        question: "Do coding agents need logs?",
        answer:
          "They need useful activity records. The record should help a developer diagnose provider, tool, context, or validation problems without exposing unnecessary sensitive content.",
      },
    ],
  },
  {
    slug: "how-to-evaluate-coding-agents",
    title: "How to Evaluate a Coding Agent on Real Repositories",
    description:
      "Evaluate coding agents with realistic tasks, repeatable criteria, tool behavior, review quality, and failure handling instead of a single impressive demo.",
    excerpt:
      "A useful coding-agent evaluation measures how it works in a repository, not whether it can produce one plausible snippet.",
    publishedAt: "2026-08-24",
    updatedAt: "2026-08-24",
    readingTime: "8 min read",
    keywords: [
      "evaluate coding agents",
      "coding agent benchmark",
      "AI coding agent evaluation",
      "agent evals",
    ],
    sections: [
      {
        heading: "Use tasks that resemble your work",
        paragraphs: [
          "A benchmark question with one correct answer can be useful, but it does not tell you how an agent will behave in your codebase. Build a small task set from real maintenance work: explain a subsystem, find a regression, review a diff, add a focused test, make a bounded change, and recover from a failed command.",
          "Keep tasks safe and reversible. A disposable repository or branch lets you compare agents without turning an evaluation into a production incident.",
        ],
      },
      {
        heading: "Measure the workflow, not just the final text",
        paragraphs: [
          "A correct patch is not enough if the agent used excessive context, ignored a permission boundary, changed unrelated files, or could not explain what it did. Evaluate the path as well as the outcome.",
        ],
        bullets: [
          "Did it identify the right files and constraints?",
          "Did it use tools deliberately and recover from failures?",
          "Did it keep changes scoped and produce a reviewable diff?",
          "Did the requested validation actually run and pass?",
        ],
      },
      {
        heading: "Compare model and harness separately",
        paragraphs: [
          "The same model can behave differently with different context selection, tool schemas, permissions, and retry behavior. Record the provider, model, prompt, workspace state, and policy so you know what changed between runs.",
          "A provider-flexible runtime such as Truss makes this comparison more useful because the client workflow and tool boundaries can remain consistent while you test a different model profile.",
        ],
      },
    ],
    faqs: [
      {
        question: "What is the best benchmark for a coding agent?",
        answer:
          "The best benchmark is a repeatable set of safe tasks drawn from the work your team actually does, with clear expected evidence and validation.",
      },
      {
        question: "Should I evaluate an agent with one large feature?",
        answer:
          "Use a mix. Large features reveal planning and persistence, but smaller tasks make failures easier to diagnose and compare.",
      },
    ],
  },
  {
    slug: "persistent-coding-agent-sessions",
    title:
      "Persistent Coding Agent Sessions: Resume Work Without Rebuilding Context",
    description:
      "Learn why durable coding-agent sessions matter, what should persist, and how to resume work without relying on an endlessly growing chat transcript.",
    excerpt:
      "A persistent agent session should preserve useful workspace state, not force you to repeat the task every time an editor closes.",
    publishedAt: "2026-08-23",
    updatedAt: "2026-08-23",
    readingTime: "6 min read",
    keywords: [
      "persistent coding agent sessions",
      "AI agent memory",
      "resume coding agent",
      "agent checkpoint",
    ],
    sections: [
      {
        heading: "A session is more than chat history",
        paragraphs: [
          "A durable coding-agent session can retain the task, selected model profile, mode, permission policy, plan, useful workspace notes, and a bounded conversation transcript. That makes it possible to resume a real task without pretending every previous token needs to be sent again.",
          "Persistence should be intentional. A session needs enough state to continue responsibly, but it should not silently preserve credentials or grow into an unsearchable archive of stale context.",
        ],
      },
      {
        heading: "Checkpoints make interruptions recoverable",
        paragraphs: [
          "Coding work is interrupted by editor restarts, failed provider requests, network changes, and simple context switches. A checkpoint records where the agent was, what it had observed, and what still needs verification so the next run can recover without guessing.",
        ],
        bullets: [
          "Task and implementation-plan status",
          "Selected provider, model, and agent mode",
          "Relevant workspace notes and changed-file state",
          "Bounded conversation history and recent tool outcomes",
        ],
      },
      {
        heading: "Resume with verification, not blind continuation",
        paragraphs: [
          "A resumed agent should re-check the workspace before it acts. Files may have changed, a branch may have moved, or a previous command may not have completed. The right behavior is to use the stored session as a starting point, then inspect current evidence.",
          "Truss treats plans, workspace memory, and sessions as durable runtime state while still keeping tool activity and Git review visible when work resumes.",
        ],
      },
    ],
    faqs: [
      {
        question: "Should an AI coding agent remember everything forever?",
        answer:
          "No. Keep durable task and workspace state, but bound conversation history and re-check live files before resuming work.",
      },
      {
        question: "What is an agent checkpoint?",
        answer:
          "A checkpoint is saved state that helps an agent resume after an interruption, including task progress, relevant context, and recent outcomes.",
      },
    ],
  },
  {
    slug: "multi-agent-coding-workflow",
    title: "Multi-Agent Coding Workflows: When Parallel Agents Help",
    description:
      "Use multiple coding agents without creating chaos: split research, review, and implementation work, define boundaries, and keep one human accountable.",
    excerpt:
      "Parallel agents help when tasks are independent and reviewable. They hurt when every agent changes the same files without a clear owner.",
    publishedAt: "2026-08-22",
    updatedAt: "2026-08-22",
    readingTime: "7 min read",
    keywords: [
      "multi-agent coding workflow",
      "parallel coding agents",
      "AI agent orchestration",
      "multi-agent software development",
    ],
    sections: [
      {
        heading: "Parallelism is not the same as delegation",
        paragraphs: [
          "Multiple agents are most useful when they can investigate or produce independent evidence at the same time. One agent can map an unfamiliar subsystem, another can review a diff, and another can draft test cases. A developer can then decide what should become a change.",
          "Sending several agents into the same files with the same vague request usually creates duplication, conflicting edits, and more review work than it saves.",
        ],
      },
      {
        heading: "Give each agent a bounded role",
        paragraphs: [
          "Define the goal, inputs, allowed tools, and expected output for each run. Read-only research and review are easy to parallelize because they do not compete for workspace state. Writing tasks should have clear file ownership or happen sequentially after the evidence is combined.",
        ],
        bullets: [
          "Research agent: inspect and summarize a subsystem.",
          "Review agent: identify risks in a change or plan.",
          "Test agent: propose cases and validation commands.",
          "Implementation agent: make one bounded, reviewed change.",
        ],
      },
      {
        heading: "Keep a human as the integration point",
        paragraphs: [
          "Agents can produce useful observations, but the integration decision belongs to the person responsible for the repository. Review the evidence, resolve conflicts, choose the implementation path, and run the final validation once.",
          "Truss keeps agents and their activity scoped to the workspace so parallel work can remain visible instead of leaking unrelated plans into a primary conversation.",
        ],
      },
    ],
    faqs: [
      {
        question: "When should I use multiple coding agents?",
        answer:
          "Use them for independent research, review, test design, or clearly separated implementation tasks. Avoid parallel edits to the same uncertain area.",
      },
      {
        question: "Can multiple agents edit the same repository?",
        answer:
          "They can, but it requires explicit ownership and review. Read-only parallel work is safer and often more useful.",
      },
    ],
  },
  {
    slug: "provider-agnostic-ai-agent",
    title:
      "Provider-Agnostic AI Agents: Avoid Lock-In Without Losing Capability",
    description:
      "A provider-agnostic AI agent keeps models, credentials, tools, and workflows separate so developers can choose the right provider for each task.",
    excerpt:
      "Provider flexibility is not about chasing every model. It is about keeping one workflow when a model, account, price, or policy changes.",
    publishedAt: "2026-08-21",
    updatedAt: "2026-08-21",
    readingTime: "6 min read",
    keywords: [
      "provider-agnostic AI agent",
      "multi-provider coding agent",
      "AI provider lock-in",
      "BYOK agent",
    ],
    sections: [
      {
        heading: "Provider choice is an engineering constraint",
        paragraphs: [
          "Model capability, price, context length, availability, privacy requirements, and account policy change over time. A coding workflow that only works with one provider turns each of those changes into a migration.",
          "A provider-agnostic agent separates provider configuration from agent behavior. The tools, workspace context, permissions, and session model stay stable while the active provider profile can change.",
        ],
      },
      {
        heading: "Use profiles instead of hardcoded assumptions",
        paragraphs: [
          "A profile describes the endpoint, model, credential reference, and context setting that make sense for a task. It can point to a local server or a supported cloud account. Credentials should be stored in client-managed secure storage rather than committed with a repository.",
        ],
        bullets: [
          "Use a local profile for private or offline work.",
          "Use a cloud profile when a task needs stronger reasoning or capacity.",
          "Keep a fallback profile for provider outages or limits.",
          "Name profiles by purpose, not by a temporary model trend.",
        ],
      },
      {
        heading: "Flexibility needs an honest connection test",
        paragraphs: [
          "Provider support is only real when a profile can test its endpoint, authenticate, list or select a usable model, and report errors clearly. A 401 authentication failure, a network failure, and a rate limit are different conditions that should not be hidden behind one message.",
          "Truss keeps provider selection within the same runtime so a change in model provider does not require a different client workflow or tool policy.",
        ],
      },
    ],
    faqs: [
      {
        question: "What does provider-agnostic mean for an AI agent?",
        answer:
          "It means the agent is designed to work with multiple compatible model providers while keeping its context, tools, permissions, and client workflow independent from any one vendor.",
      },
      {
        question: "Does provider-agnostic mean every model works equally well?",
        answer:
          "No. Models differ in tool use, context, reliability, and price. Provider flexibility lets you choose deliberately without replacing the entire workflow.",
      },
    ],
  },
  {
    slug: "coding-agent-safety-boundaries",
    title: "Coding Agent Safety Boundaries: Keep Automation Reviewable",
    description:
      "Set practical safety boundaries for a coding agent with read-only modes, scoped permissions, approvals, diffs, and testable completion criteria.",
    excerpt:
      "Safe coding-agent automation is not about removing tools. It is about making powerful tools explicit, scoped, and reviewable.",
    publishedAt: "2026-08-20",
    updatedAt: "2026-08-20",
    readingTime: "7 min read",
    keywords: [
      "coding agent safety",
      "AI agent guardrails",
      "agent permissions",
      "safe coding automation",
    ],
    sections: [
      {
        heading: "Start with the least powerful mode",
        paragraphs: [
          "A coding agent does not need write access to explain an error, map a module, summarize a diff, or propose a plan. Read-only work is the right default for unfamiliar repositories and tasks where the main risk is a wrong assumption.",
          "Move into a mutating mode only when the task is clear, the relevant files are known, and you are ready to review the result. That keeps exploration useful without making every question an automation event.",
        ],
      },
      {
        heading: "Scope capability to the task",
        paragraphs: [
          "Permissions should distinguish reading, writing, terminal execution, Git actions, and network access. A broad 'allow everything' switch is convenient, but it removes the signal that helps a developer notice an unexpected request.",
        ],
        bullets: [
          "Use Chat for non-mutating questions.",
          "Use Plan for read-only investigation and proposed steps.",
          "Use Agent when edits or commands are actually needed.",
          "Review requested actions when the policy asks.",
        ],
      },
      {
        heading: "Review is the final boundary",
        paragraphs: [
          "A permission prompt is not the last check. Inspect the changed files, read the Git diff, and run the validation that proves the task is complete. A clear stop button and visible activity make it possible to interrupt work before it expands.",
          "Truss keeps these boundaries close to the agent workflow so a developer can grant the right capability for a real task without abandoning normal code review habits.",
        ],
      },
    ],
    faqs: [
      {
        question: "Are coding agents safe to use on production repositories?",
        answer:
          "They can be useful when work is scoped, permissions are explicit, sensitive actions are reviewed, and normal Git and test workflows remain in control.",
      },
      {
        question: "What is the safest mode for a coding agent?",
        answer:
          "A read-only mode is safest for understanding a workspace. Grant writing or terminal capabilities only when a clear task requires them.",
      },
    ],
  },
  {
    slug: "agentic-software-development-workflow",
    title: "Agentic Software Development: A Practical Workflow for Developers",
    description:
      "Build an agentic software-development workflow around investigation, planning, bounded execution, review, and validation instead of one giant prompt.",
    excerpt:
      "Agentic development works best as a repeatable engineering loop: inspect, plan, act with boundaries, review, and verify.",
    publishedAt: "2026-08-19",
    updatedAt: "2026-08-19",
    readingTime: "8 min read",
    keywords: [
      "agentic software development",
      "agentic coding workflow",
      "AI software development workflow",
      "coding agent workflow",
    ],
    sections: [
      {
        heading: "Treat the agent as part of the development loop",
        paragraphs: [
          "Agentic software development is not handing a vague feature request to a model and hoping for a finished product. It is a workflow where an agent can inspect evidence, propose a plan, use bounded tools, and produce a change that a developer can review and validate.",
          "This mirrors good engineering practice. The agent accelerates investigation and execution, while the developer retains responsibility for scope, trade-offs, and acceptance criteria.",
        ],
      },
      {
        heading: "Use a five-step loop",
        paragraphs: [
          "A repeatable loop prevents both the developer and the agent from jumping to edits before the problem is understood.",
        ],
        bullets: [
          "Inspect: gather the error, affected files, and current Git state.",
          "Plan: state the intended change and validation before writing.",
          "Execute: use only the tools and permissions the task needs.",
          "Review: inspect the diff, tool activity, and unexpected changes.",
          "Verify: run tests, checks, or a concrete manual validation.",
        ],
      },
      {
        heading: "Make the handoff explicit",
        paragraphs: [
          "A good agent response identifies what changed, what it verified, and what remains uncertain. That makes it useful during a pull-request review or a later debugging session, not just at the moment a patch appears.",
          "Truss supports this loop with Chat for questions, Plan for read-only investigation, Agent for permitted execution, durable workspace state, and Git-aware views for review.",
        ],
      },
    ],
    faqs: [
      {
        question: "What is agentic software development?",
        answer:
          "It is a development approach where agents participate in a structured engineering loop, using context and tools under human-defined boundaries rather than acting as a one-shot code generator.",
      },
      {
        question: "Does agentic development replace code review?",
        answer:
          "No. It can improve preparation and execution, but diffs, tests, and human acceptance remain essential.",
      },
    ],
  },
] as const satisfies readonly BlogArticle[];

export function getBlogArticle(slug: string): BlogArticle | undefined {
  return blogArticles.find((article) => article.slug === slug);
}
