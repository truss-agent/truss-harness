#!/usr/bin/env node
import { cwd } from "node:process";
import { detectLocalEndpoints, listLocalModels } from "@truss-harness/provider-openai-compatible";
import { brand } from "@truss-harness/branding";
import { executeWorkspaceCommand, workspaceCommandHelp } from "@truss-harness/runtime";
import { createClientRuntime } from "./runtime.js";
import { configurationPaths, initializeWorkspaceConfiguration, parseConfigurationOverrides, resolveConfiguration } from "./config.js";
import { ProtocolToolApproval, runService } from "./protocol.js";

const help = `${brand.productName} CLI

Local-first coding agent and runtime service.

Usage:
  ${brand.cliCommand} <command> [options]

Quick start:
  1. Start Ollama, LM Studio, llama.cpp, or a compatible local server.
  2. Run: ${brand.cliCommand} models
  3. Run: ${brand.cliCommand} chat "Explain this workspace"
  4. Optional: ${brand.cliCommand} config init

Commands:
  chat <prompt>          Stream one agent response in the current workspace
  models                List detected local servers and models
  config path           Print user and workspace configuration paths
  config init           Create a workspace configuration template
  init                  Create or refresh generated AGENTS.md workspace context
  update [note]         Record Git state and a durable handoff note
  status                Show Git state and recent durable agent records
  clear-memory          Delete this workspace's durable agent memory
  commands              Print slash commands shared by interactive clients
  serve                 Start the JSONL runtime service for editor clients
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

Examples:
  ${brand.cliCommand} chat --mode plan "Plan the authentication change"
  ${brand.cliCommand} chat --mode edit "Fix the failing tests"
  ${brand.cliCommand} chat --internet-access "Check the current library documentation"
  ${brand.cliCommand} chat --profile lm-studio "Review the active file structure"

${workspaceCommandHelp()}
`;

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

  if (command === "chat") {
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
    const { runtime, events } = createClientRuntime({ ...configuration, approval });
    await runService(runtime, events, approval);
    return;
  }

  const { runtime, events } = createClientRuntime(configuration);

  if (command === "chat") {
    const prompt = args.join(" ").trim();
    events.subscribe((event) => {
      if (event.type === "text_delta") process.stdout.write(event.text);
      if (event.type === "tool_call_requested") process.stderr.write(`\n[tool] ${event.tool}\n`);
      if (event.type === "plan_updated") {
        process.stderr.write(`\n[plan] ${event.plan.title}\n${event.plan.steps.map((step) => `  ${step.status === "completed" ? "[x]" : step.status === "in_progress" ? "[..]" : "[ ]"} ${step.content}`).join("\n")}\n`);
      }
    });
    const session = await runtime.createSession();
    await runtime.run(session.id, prompt);
    process.stdout.write("\n");
    return;
  }

  throw new Error(`Unknown command: ${command}\n\n${help}`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
