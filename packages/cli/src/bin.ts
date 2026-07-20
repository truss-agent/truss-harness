#!/usr/bin/env node
import { cwd } from "node:process";
import { basename, resolve as resolvePath } from "node:path";
import { createInterface } from "node:readline/promises";
import { detectLocalEndpoints, listLocalModels, type LocalEndpointKind, type LocalModelEndpoint } from "@truss-harness/provider-openai-compatible";
import { brand } from "@truss-harness/branding";
import { executeWorkspaceCommand, workspaceCommandHelp } from "@truss-harness/runtime";
import { createClientRuntime, type ClientRuntime } from "./runtime.js";
import { configurationPaths, initializeWorkspaceConfiguration, parseConfigurationOverrides, resolveConfiguration, saveUserProfile, type ResolvedConfiguration } from "./config.js";
import { ProtocolToolApproval, runService, type PermissionMode } from "./protocol.js";
import { startRemoteGateway } from "@truss-harness/gateway";

const help = `${brand.productName} CLI

Local-first coding agent and runtime service.

Usage:
  ${brand.cliCommand} <command> [options]

Quick start:
  1. Start Ollama, LM Studio, llama.cpp, or a compatible local server.
  2. Run: ${brand.cliCommand} models
 3. Run: ${brand.cliCommand} chat "Explain this workspace"
  3. Run: ${brand.cliCommand} setup
  4. Run: ${brand.cliCommand} chat --mode edit
  5. Optional: ${brand.cliCommand} config init

Commands:
  chat [prompt]          Stream one response or open persistent chat
  setup                 Interactively choose and save local-model defaults
  models                List detected local servers and models
  config path           Print user and workspace configuration paths
  config init           Create a workspace configuration template
  init                  Create or refresh generated AGENTS.md workspace context
  update [note]         Record Git state and a durable handoff note
  status                Show Git state and recent durable agent records
  clear-memory          Delete this workspace's durable agent memory
  commands              Print slash commands shared by interactive clients
  serve                 Start the JSONL runtime service for editor clients
  gateway               Start a loopback HTTP/SSE gateway for the mobile client
  help                  Show this reference

Options:
  --profile <name>       Select a named configuration profile
  --provider <name>      ollama or openai-compatible
  --base-url <url>       Local server endpoint
  --model <name>         Model identifier
  --mode <name>          chat, plan, or edit
  --permission <name>    ask, auto-read, or auto-all
  --internet-access      Enable public web search and page fetching
  --no-internet-access   Disable internet tools
  --gateway-token <token>  Required 24+ character token for gateway clients
  --gateway-port <port>    Gateway port (default: 4787)
  --gateway-host <host>    Bind address (default: 127.0.0.1; use a trusted LAN only)
  --gateway-workspace <path> Share a workspace; repeat to offer multiple workspaces

Modes:
  chat                   Conversation only; optional internet tools
  plan                   Read-only inspection and a saved implementation plan
  edit                   Filesystem, planning, and terminal tools

Permissions:
  ask                    Ask interactive clients before each tool
  auto-read              Auto-allow workspace reads; ask for writes, commands, and web
  auto-all               Auto-allow every registered tool

  Direct '${brand.cliCommand} chat' runs non-interactively and auto-allows tools.
  Use it only in a trusted workspace. Internet tools remain off unless enabled.

Environment:
  TRUSS_HARNESS_MODEL       Required model identifier
  TRUSS_HARNESS_PROVIDER    ollama (default) or openai-compatible
  TRUSS_HARNESS_BASE_URL    Local server base URL (default depends on provider)
  TRUSS_HARNESS_AGENT_MODE  chat (default), plan, or edit
  TRUSS_HARNESS_PERMISSION_MODE ask (default), auto-read, or auto-all
  TRUSS_HARNESS_INTERNET_ACCESS true or 1 to enable public web tools
  TRUSS_HARNESS_API_KEY     Optional bearer token
  TRUSS_HARNESS_SYSTEM_PROMPT Optional system prompt
  TRUSS_HARNESS_MCP_SERVERS JSON object containing local stdio MCP servers

Examples:
  ${brand.cliCommand} chat --mode plan "Plan the authentication change"
  ${brand.cliCommand} chat --mode edit "Fix the failing tests"
  ${brand.cliCommand} chat --internet-access "Check the current library documentation"
  ${brand.cliCommand} chat --profile lm-studio "Review the active file structure"

${workspaceCommandHelp()}
`;

function subscribeToRuntimeEvents(events: ClientRuntime["events"]): void {
  events.subscribe((event) => {
    if (event.type === "text_delta") process.stdout.write(event.text);
    if (event.type === "tool_call_requested") process.stderr.write("\n[tool] " + event.tool + "\n");
    if (event.type === "plan_updated") {
      const steps = event.plan.steps.map((step) => "  " + (step.status === "completed" ? "[x]" : step.status === "in_progress" ? "[..]" : "[ ]") + " " + step.content).join("\n");
      process.stderr.write("\n[plan] " + event.plan.title + "\n" + steps + "\n");
    }
  });
}

function inlineMode(input: string): { readonly mode?: "chat" | "plan" | "edit"; readonly prompt: string } {
  const match = input.trim().match(/^--mode\s+(chat|plan|edit)(?:\s+([\s\S]*))?$/);
  return match ? { mode: match[1] as "chat" | "plan" | "edit", prompt: match[2]?.trim() ?? "" } : { prompt: input.trim() };
}

function gatewayArguments(rawArgs: readonly string[]): { readonly token?: string; readonly host?: string; readonly port: number; readonly workspaceRoots: readonly string[]; readonly rest: readonly string[] } {
  let token: string | undefined;
  let host: string | undefined;
  let port = 4787;
  const workspaceRoots: string[] = [];
  const rest: string[] = [];
  for (let index = 0; index < rawArgs.length; index++) {
    const argument = rawArgs[index];
    if (argument === "--gateway-token") {
      token = rawArgs[++index];
      continue;
    }
    if (argument === "--gateway-port") {
      const value = Number.parseInt(rawArgs[++index] ?? "", 10);
      if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) throw new Error("--gateway-port must be a port between 1 and 65535.");
      port = value;
      continue;
    }
    if (argument === "--gateway-host") {
      const value = rawArgs[++index];
      if (!value?.trim()) throw new Error("--gateway-host must be a non-empty hostname or address.");
      host = value;
      continue;
    }
    if (argument === "--gateway-workspace") {
      const value = rawArgs[++index];
      if (!value?.trim()) throw new Error("--gateway-workspace must be a non-empty path.");
      workspaceRoots.push(value);
      continue;
    }
    rest.push(argument);
  }
  return { token, host, port, workspaceRoots, rest };
}

async function waitForShutdown(): Promise<void> {
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
}

async function runInteractiveChat(initialConfiguration: ResolvedConfiguration): Promise<void> {
  let configuration = initialConfiguration;
  let client = await createClientRuntime(configuration);
  let session = await client.runtime.createSession();
  let messages = session.messages;
  subscribeToRuntimeEvents(client.events);
  const readline = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY === true });
  process.stdout.write(brand.productName + " interactive chat. :help for controls. Mode: " + configuration.mode + ".\n");

  const replaceRuntime = async (mode: "chat" | "plan" | "edit"): Promise<void> => {
    const current = await client.runtime.getSession(session.id);
    messages = current?.messages ?? messages;
    await client.dispose();
    configuration = { ...configuration, mode };
    client = await createClientRuntime(configuration);
    session = await client.runtime.createSession(messages);
    subscribeToRuntimeEvents(client.events);
    process.stdout.write("\n[mode: " + mode + "]\n");
  };

  try {
    while (true) {
      const line = await readline.question(brand.cliCommand + " (" + configuration.mode + ") > ").catch(() => undefined);
      if (line === undefined) break;
      const input = line.trim();
      if (!input) continue;
      if (input === ":exit" || input === ":quit") break;
      if (input === ":help") {
        process.stdout.write("Controls: :mode chat|plan|edit, :clear, :exit. You can also prefix a message with --mode chat|plan|edit.\n");
        continue;
      }
      if (input === ":clear") {
        session = await client.runtime.createSession();
        messages = session.messages;
        process.stdout.write("[conversation cleared]\n");
        continue;
      }
      const modeCommand = input.match(/^:mode\s+(chat|plan|edit)$/);
      if (modeCommand) {
        await replaceRuntime(modeCommand[1] as "chat" | "plan" | "edit");
        continue;
      }
      if (input.startsWith(":mode")) {
        process.stdout.write("Use :mode chat, :mode plan, or :mode edit.\n");
        continue;
      }

      const next = inlineMode(input);
      if (next.mode && next.mode !== configuration.mode) await replaceRuntime(next.mode);
      if (!next.prompt) continue;
      const workspaceCommand = await executeWorkspaceCommand({ workspaceRoot: cwd(), input: next.prompt });
      if (workspaceCommand.handled) {
        process.stdout.write(workspaceCommand.message + "\n");
        continue;
      }
      try {
        await client.runtime.run(session.id, next.prompt);
        process.stdout.write("\n");
      } catch (error) {
        process.stderr.write("\n" + (error instanceof Error ? error.message : String(error)) + "\n");
      }
    }
  } finally {
    readline.close();
    await client.dispose();
  }
}

function selectedIndex(input: string, count: number, fallback: number): number {
  const index = Number.parseInt(input, 10);
  return Number.isInteger(index) && index >= 1 && index <= count ? index - 1 : fallback;
}

async function runSetup(): Promise<void> {
  const readline = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY === true });
  const ask = async (label: string, fallback: string): Promise<string> => {
    const answer = (await readline.question(label + " [" + fallback + "]: ")).trim();
    return answer || fallback;
  };

  try {
    const endpoints = await detectLocalEndpoints();
    process.stdout.write(brand.productName + " setup\n");
    process.stdout.write("Choose a local model server. Values in brackets are defaults.\n\n");
    endpoints.forEach((endpoint, index) => process.stdout.write(String(index + 1) + ". " + endpoint.label + " (" + endpoint.baseUrl + ")\n"));
    process.stdout.write(String(endpoints.length + 1) + ". Custom endpoint\n");
    const endpointChoice = selectedIndex(await ask("Server", "1"), endpoints.length + 1, 0);

    let endpoint: LocalModelEndpoint;
    if (endpointChoice < endpoints.length) {
      endpoint = endpoints[endpointChoice];
    } else {
      const provider = await ask("Provider: ollama or openai-compatible", "openai-compatible") as LocalEndpointKind;
      if (provider !== "ollama" && provider !== "openai-compatible") throw new Error("Provider must be ollama or openai-compatible.");
      const fallbackUrl = provider === "ollama" ? "http://127.0.0.1:11434" : "http://127.0.0.1:1234/v1";
      endpoint = { id: "custom", label: "Custom endpoint", kind: provider, baseUrl: await ask("Endpoint URL", fallbackUrl) };
    }

    const models = await listLocalModels(endpoint).catch(() => []);
    models.forEach((model, index) => process.stdout.write(String(index + 1) + ". " + model.name + "\n"));
    const model = models.length
      ? models[selectedIndex(await ask("Model", "1"), models.length, 0)].name
      : await ask("Model ID", "local-model");
    const profileName = await ask("Profile name", endpoint.id === "custom" ? "local" : endpoint.id);
    const mode = await ask("Default mode: chat, plan, or edit", "edit");
    if (mode !== "chat" && mode !== "plan" && mode !== "edit") throw new Error("Mode must be chat, plan, or edit.");
    const permission = await ask("Default permission: ask, auto-read, or auto-all", "auto-read");
    if (permission !== "ask" && permission !== "auto-read" && permission !== "auto-all") throw new Error("Permission must be ask, auto-read, or auto-all.");
    const internet = await ask("Enable internet research: yes or no", "no");
    const path = await saveUserProfile(cwd(), profileName, {
      provider: endpoint.kind,
      baseUrl: endpoint.baseUrl,
      model,
      mode,
      permission,
      internetAccess: /^(y|yes|true|1)$/i.test(internet)
    });
    process.stdout.write("\nSaved profile '" + profileName + "' to " + path + "\n");
    process.stdout.write("Start a persistent session with: " + brand.cliCommand + " chat --profile " + profileName + "\n");
  } finally {
    readline.close();
  }
}

async function main(): Promise<void> {
  const [command = "help", ...rawArgs] = process.argv.slice(2);
  if (command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(help);
    return;
  }

  if (command === "models") {
    const endpoints = await detectLocalEndpoints();
    const models = await Promise.all(endpoints.map(async (endpoint) => ({ endpoint, models: await listLocalModels(endpoint) })));
    process.stdout.write(`${JSON.stringify(models, null, 2)}\n`);
    return;
  }

  if (command === "setup") {
    await runSetup();
    return;
  }

  if (command === "config") {
    const [action = "path"] = rawArgs;
    const paths = configurationPaths(cwd());
    if (action === "path") {
      process.stdout.write(`${JSON.stringify(paths, null, 2)}\n`);
      return;
    }
    if (action === "init") {
      process.stdout.write(`Created ${await initializeWorkspaceConfiguration(cwd(), paths)}\n`);
      return;
    }
    throw new Error(`Use ${brand.cliCommand} config path or ${brand.cliCommand} config init`);
  }

  if (command === "gateway") {
    const gateway = gatewayArguments(rawArgs);
    if (!gateway.token || gateway.token.length < 24) throw new Error("Set --gateway-token to a random value with at least 24 characters.");
    const { overrides } = parseConfigurationOverrides([...gateway.rest]);
    const workspaceRoots = gateway.workspaceRoots.length ? gateway.workspaceRoots.map((path) => resolvePath(cwd(), path)) : [cwd()];
    const clients = new Map<string, { readonly client: ClientRuntime; readonly approval: ProtocolToolApproval }>();
    const workspaces = await Promise.all(workspaceRoots.map(async (workspaceRoot, index) => {
      const configuration = await resolveConfiguration({ workspaceRoot, overrides });
      const id = `workspace-${index + 1}`;
      return {
        id,
        displayName: basename(workspaceRoot),
        createRuntime: async (mode: "chat" | "plan" | "edit", toolApprovalMode?: PermissionMode) => {
          const key = `${id}:${mode}:${toolApprovalMode ?? configuration.permission}`;
          const current = clients.get(key);
          if (current) return { runtime: current.client.runtime, events: current.client.events, approval: current.approval };
          const approval = new ProtocolToolApproval(toolApprovalMode ?? configuration.permission);
          const client = await createClientRuntime({ ...configuration, mode, approval });
          clients.set(key, { client, approval });
          return { runtime: client.runtime, events: client.events, approval };
        }
      };
    }));
    const server = await startRemoteGateway({
      token: gateway.token,
      port: gateway.port,
      host: gateway.host,
      workspaces
    });
    process.stdout.write(`Truss mobile gateway listening at ${server.url}\n`);
    process.stdout.write("It binds to loopback by default. A non-loopback host is for a trusted LAN or secure tunnel only; do not expose it to the public internet without TLS and device-pairing support.\n");
    try {
      await waitForShutdown();
    } finally {
      await server.close();
      await Promise.all([...clients.values()].map(async ({ client }) => client.dispose()));
    }
    return;
  }

  const { overrides, rest: args } = parseConfigurationOverrides(rawArgs);
  const workspaceCommand = command === "init" ? "/init"
    : command === "update" ? `/update ${args.join(" ")}`.trim()
      : command === "status" ? "/status"
        : command === "clear-memory" ? "/clear-memory"
          : command === "commands" ? "/help"
            : undefined;
  if (workspaceCommand) {
    const result = await executeWorkspaceCommand({ workspaceRoot: cwd(), input: workspaceCommand });
    process.stdout.write(`${result.message}\n`);
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === "chat" && args.length) {
    const prompt = args.join(" ").trim();
    if (!prompt) throw new Error(`Provide a prompt: ${brand.cliCommand} chat <prompt>`);
    const result = await executeWorkspaceCommand({ workspaceRoot: cwd(), input: prompt });
    if (result.handled) {
      process.stdout.write(`${result.message}\n`);
      if (!result.ok) process.exitCode = 1;
      return;
    }
  }

  const configuration = await resolveConfiguration({ workspaceRoot: cwd(), overrides });

  if (command === "serve") {
    const approval = new ProtocolToolApproval(configuration.permission);
    const client = await createClientRuntime({ ...configuration, approval });
    for (const server of client.mcpServers) {
      process.stderr.write(`[mcp] ${server.name}: ${server.state}${server.error ? ` (${server.error})` : ` (${server.toolCount} tools)`}\n`);
    }
    try {
      await runService(client.runtime, client.events, approval);
    } finally {
      await client.dispose();
    }
    return;
  }

  if (command === "chat" && !args.join(" ").trim()) {
    await runInteractiveChat(configuration);
    return;
  }

  const client = await createClientRuntime(configuration);
  const { runtime, events } = client;
  for (const server of client.mcpServers) {
    process.stderr.write(`[mcp] ${server.name}: ${server.state}${server.error ? ` (${server.error})` : ` (${server.toolCount} tools)`}\n`);
  }

  if (command === "chat") {
    const prompt = args.join(" ").trim();
    events.subscribe((event) => {
      if (event.type === "text_delta") process.stdout.write(event.text);
      if (event.type === "tool_call_requested") process.stderr.write(`\n[tool] ${event.tool}\n`);
      if (event.type === "plan_updated") {
        process.stderr.write(`\n[plan] ${event.plan.title}\n${event.plan.steps.map((step) => `  ${step.status === "completed" ? "[x]" : step.status === "in_progress" ? "[..]" : "[ ]"} ${step.content}`).join("\n")}\n`);
      }
    });
    try {
      const session = await runtime.createSession();
      await runtime.run(session.id, prompt);
      process.stdout.write("\n");
    } finally {
      await client.dispose();
    }
    return;
  }

  throw new Error(`Unknown command: ${command}\n\n${help}`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
