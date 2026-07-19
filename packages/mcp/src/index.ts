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
  readonly state: "connected" | "failed";
  readonly toolCount: number;
  readonly error?: string;
}

export interface McpConnections {
  readonly statuses: readonly McpServerStatus[];
  close(): Promise<void>;
}

const startupTimeoutMs = 10_000;

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

async function listAllTools(client: Client): Promise<readonly {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: unknown;
}[]> {
  const tools = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined, { timeout: startupTimeoutMs });
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);
  return tools;
}

export async function registerMcpServers(
  registry: ToolRegistry,
  configurations: McpServerConfigurations | undefined,
  options: {
    readonly workspaceRoot: string;
    readonly environment?: NodeJS.ProcessEnv;
  },
): Promise<McpConnections> {
  const clients: Client[] = [];
  const statuses: McpServerStatus[] = [];
  const environment = options.environment ?? process.env;

  for (const [serverName, configuration] of Object.entries(configurations ?? {})) {
    if (configuration.enabled === false) continue;
    if (!configuration.command.trim()) {
      statuses.push({ name: serverName, state: "failed", toolCount: 0, error: "command must be a non-empty string" });
      continue;
    }

    const client = new Client({ name: "truss-harness", version: "0.1.0" });
    try {
      const transport = new StdioClientTransport({
        command: configuration.command,
        args: [...(configuration.args ?? [])],
        cwd: configuration.cwd ? resolve(options.workspaceRoot, configuration.cwd) : options.workspaceRoot,
        env: resolvedEnvironment(configuration.env, environment),
        stderr: "pipe",
      });
      transport.stderr?.on("data", () => undefined);
      await client.connect(transport, { timeout: startupTimeoutMs });
      const definitions = await listAllTools(client);
      const tools = definitions.map((definition) => mcpTool(serverName, client, definition));
      const names = new Set<string>();
      for (const tool of tools) {
        if (names.has(tool.name) || registry.get(tool.name)) throw new Error(`MCP tool name collision: ${tool.name}`);
        names.add(tool.name);
      }
      for (const tool of tools) registry.register(tool);
      clients.push(client);
      statuses.push({ name: serverName, state: "connected", toolCount: definitions.length });
    } catch (error) {
      await client.close().catch(() => undefined);
      statuses.push({
        name: serverName,
        state: "failed",
        toolCount: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    statuses,
    async close(): Promise<void> {
      await Promise.allSettled(clients.map((client) => client.close()));
    },
  };
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
