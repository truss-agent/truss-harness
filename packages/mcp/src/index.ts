import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { AgentTool, JsonObject, JsonSchema, JsonValue, ToolRegistry, ToolResult } from "@truss-harness/runtime";

export interface McpStdioServerConfiguration {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly enabled?: boolean;
  readonly readOnly?: boolean;
}

export type McpServerConfigurations = Readonly<Record<string, McpStdioServerConfiguration>>;

export interface McpServerStatus {
  readonly name: string;
  readonly state: "idle" | "disabled" | "connecting" | "connected" | "failed";
  readonly toolCount: number;
  readonly error?: string;
  readonly tools?: readonly McpToolSummary[];
}

/** Safe, provider-independent tool metadata for client status surfaces. */
export interface McpToolSummary {
  readonly name: string;
  readonly description?: string;
  readonly readOnly: boolean;
}

export interface McpConnections {
  readonly statuses: readonly McpServerStatus[];
  subscribe(listener: (statuses: readonly McpServerStatus[]) => void): () => void;
  reconnect(name: string): Promise<McpServerStatus | undefined>;
  disconnect(name: string): Promise<void>;
  close(): Promise<void>;
}

const startupTimeoutMs = 10_000;

type McpToolDefinition = {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: unknown;
};

function safeName(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || "tool";
}

function environmentValue(value: string, environment: NodeJS.ProcessEnv): string {
  return value.replace(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => environment[name] ?? "");
}

function resolvedEnvironment(
  values: Readonly<Record<string, string>> | undefined,
  environment: NodeJS.ProcessEnv,
): Record<string, string> | undefined {
  if (!values) return getDefaultEnvironment();
  return {
    ...getDefaultEnvironment(),
    ...Object.fromEntries(Object.entries(values).map(([name, value]) => [name, environmentValue(value, environment)])),
  };
}

function jsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item)]));
  }
  return String(value);
}

function textResult(result: {
  readonly content?: readonly unknown[];
  readonly structuredContent?: unknown;
  readonly isError?: boolean;
}): ToolResult {
  const parts: string[] = [];
  for (const item of result.content ?? []) {
    if (item && typeof item === "object" && "type" in item && item.type === "text" && "text" in item && typeof item.text === "string") {
      parts.push(item.text);
    } else {
      parts.push(JSON.stringify(jsonValue(item)));
    }
  }
  if (result.structuredContent !== undefined) parts.push(JSON.stringify(jsonValue(result.structuredContent), null, 2));
  const content = parts.filter(Boolean).join("\n\n").slice(0, 100_000);
  return { content: content || "(MCP tool returned no text content.)", isError: result.isError };
}

function mcpTool(
  serverName: string,
  client: Client,
  definition: { readonly name: string; readonly description?: string; readonly inputSchema: unknown },
): AgentTool {
  return {
    name: `mcp_${safeName(serverName)}_${safeName(definition.name)}`,
    description: `[MCP: ${serverName}] ${definition.description ?? definition.name}`,
    inputSchema: jsonValue(definition.inputSchema) as JsonSchema,
    async execute(input, context): Promise<ToolResult> {
      const result = await client.callTool(
        { name: definition.name, arguments: input },
        undefined,
        context.signal ? { signal: context.signal } : undefined,
      );
      return textResult(result as {
        readonly content?: readonly unknown[];
        readonly structuredContent?: unknown;
        readonly isError?: boolean;
      });
    },
  };
}

async function listAllTools(client: Client): Promise<readonly McpToolDefinition[]> {
  const tools = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined, { timeout: startupTimeoutMs });
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);
  return tools;
}

function safeMcpError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/ENOENT|spawn/i.test(message)) return "The configured executable could not be started.";
  if (/timed out|timeout/i.test(message)) return "The server did not finish starting before the timeout.";
  if (/collision/i.test(message)) return "A server tool conflicts with an existing tool name.";
  return "The MCP server could not be started.";
}

/**
 * Owns MCP connection lifecycle for a single runtime. It emits only safe
 * statuses and tool descriptions; command environment values never leave it.
 */
export class McpServerManager {
  private readonly clients = new Map<string, Client>();
  private readonly toolNames = new Map<string, readonly string[]>();
  private readonly statusByName = new Map<string, McpServerStatus>();
  private readonly listeners = new Set<(statuses: readonly McpServerStatus[]) => void>();
  private readonly environment: NodeJS.ProcessEnv;

  constructor(
    private readonly registry: ToolRegistry,
    private readonly configurations: McpServerConfigurations | undefined,
    private readonly options: { readonly workspaceRoot: string; readonly environment?: NodeJS.ProcessEnv },
  ) {
    this.environment = options.environment ?? process.env;
    for (const [name, configuration] of Object.entries(configurations ?? {})) {
      if (configuration.enabled === false)
        this.statusByName.set(name, { name, state: "disabled", toolCount: 0 });
    }
  }

  get statuses(): readonly McpServerStatus[] {
    return Object.keys(this.configurations ?? {}).map((name) =>
      this.statusByName.get(name) ?? { name, state: "idle", toolCount: 0 },
    );
  }

  subscribe(listener: (statuses: readonly McpServerStatus[]) => void): () => void {
    this.listeners.add(listener);
    listener(this.statuses);
    return () => this.listeners.delete(listener);
  }

  async connectAll(): Promise<readonly McpServerStatus[]> {
    for (const name of Object.keys(this.configurations ?? {})) await this.connect(name);
    return this.statuses;
  }

  async connect(name: string): Promise<McpServerStatus | undefined> {
    const configuration = this.configurations?.[name];
    if (!configuration) return undefined;
    if (configuration.enabled === false) {
      await this.disconnect(name);
      return this.setStatus({ name, state: "disabled", toolCount: 0 });
    }
    if (!configuration.command.trim())
      return this.setStatus({ name, state: "failed", toolCount: 0, error: "The server command is missing." });
    await this.disconnect(name);
    this.setStatus({ name, state: "connecting", toolCount: 0 });
    const client = new Client({ name: "truss-harness", version: "0.1.0" });
    try {
      const transport = new StdioClientTransport({
        command: configuration.command,
        args: [...(configuration.args ?? [])],
        cwd: configuration.cwd ? resolve(this.options.workspaceRoot, configuration.cwd) : this.options.workspaceRoot,
        env: resolvedEnvironment(configuration.env, this.environment),
        stderr: "pipe",
      });
      transport.stderr?.on("data", () => undefined);
      await client.connect(transport, { timeout: startupTimeoutMs });
      const definitions = await listAllTools(client);
      const tools = definitions.map((definition) => mcpTool(name, client, definition));
      const names = new Set<string>();
      for (const tool of tools) {
        if (names.has(tool.name) || this.registry.get(tool.name)) throw new Error(`MCP tool name collision: ${tool.name}`);
        names.add(tool.name);
      }
      for (const tool of tools) this.registry.register(tool);
      this.clients.set(name, client);
      this.toolNames.set(name, tools.map((tool) => tool.name));
      return this.setStatus({
        name,
        state: "connected",
        toolCount: definitions.length,
        tools: definitions.map((tool) => ({ name: tool.name, description: tool.description, readOnly: configuration.readOnly === true })),
      });
    } catch (error) {
      await client.close().catch(() => undefined);
      return this.setStatus({ name, state: "failed", toolCount: 0, error: safeMcpError(error) });
    }
  }

  async reconnect(name: string): Promise<McpServerStatus | undefined> {
    await this.disconnect(name);
    return this.connect(name);
  }

  async disconnect(name: string): Promise<void> {
    for (const toolName of this.toolNames.get(name) ?? []) this.registry.unregister(toolName);
    this.toolNames.delete(name);
    const client = this.clients.get(name);
    this.clients.delete(name);
    await client?.close().catch(() => undefined);
    const configuration = this.configurations?.[name];
    if (configuration)
      this.setStatus({
        name,
        state: configuration.enabled === false ? "disabled" : "idle",
        toolCount: 0,
      });
  }

  async close(): Promise<void> {
    await Promise.all([...this.clients.keys()].map((name) => this.disconnect(name)));
    this.listeners.clear();
  }

  private setStatus(status: McpServerStatus): McpServerStatus {
    this.statusByName.set(status.name, status);
    for (const listener of this.listeners) listener(this.statuses);
    return status;
  }
}

export async function registerMcpServers(
  registry: ToolRegistry,
  configurations: McpServerConfigurations | undefined,
  options: {
    readonly workspaceRoot: string;
    readonly environment?: NodeJS.ProcessEnv;
  },
): Promise<McpConnections> {
  const manager = new McpServerManager(registry, configurations, options);
  await manager.connectAll();
  return manager;
}

export function parseMcpServerConfigurations(value: unknown): McpServerConfigurations {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("mcpServers must be an object.");

  return Object.fromEntries(Object.entries(value).map(([name, item]) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`mcpServers.${name} must be an object.`);
    const source = item as Record<string, unknown>;
    if (typeof source.command !== "string" || !source.command.trim()) throw new Error(`mcpServers.${name}.command must be a non-empty string.`);
    if (source.args !== undefined && (!Array.isArray(source.args) || source.args.some((argument) => typeof argument !== "string"))) {
      throw new Error(`mcpServers.${name}.args must be an array of strings.`);
    }
    if (source.env !== undefined && (!source.env || typeof source.env !== "object" || Array.isArray(source.env) || Object.values(source.env).some((entry) => typeof entry !== "string"))) {
      throw new Error(`mcpServers.${name}.env must be an object of string values.`);
    }
    if (source.cwd !== undefined && typeof source.cwd !== "string") throw new Error(`mcpServers.${name}.cwd must be a string.`);
    if (source.enabled !== undefined && typeof source.enabled !== "boolean") throw new Error(`mcpServers.${name}.enabled must be a boolean.`);
    if (source.readOnly !== undefined && typeof source.readOnly !== "boolean") throw new Error(`mcpServers.${name}.readOnly must be a boolean.`);
    return [name, {
      command: source.command,
      args: source.args as string[] | undefined,
      cwd: typeof source.cwd === "string" ? source.cwd : undefined,
      env: source.env as Record<string, string> | undefined,
      enabled: source.enabled !== false,
      readOnly: source.readOnly === true,
    }];
  }));
}
