import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { brand } from "@truss-harness/branding";
import { parseMcpServerConfigurations, type McpServerConfigurations } from "@truss-harness/mcp";
import { detectActiveLocalModel, type LocalEndpointKind } from "@truss-harness/provider-openai-compatible";
import type { AgentMode, ClientConfiguration } from "./runtime.js";
import type { PermissionMode } from "./protocol.js";

export interface ProfileConfiguration {
  readonly provider?: LocalEndpointKind;
  readonly baseUrl?: string;
  readonly model?: string;
  readonly mode?: AgentMode;
  readonly permission?: PermissionMode;
  readonly internetAccess?: boolean;
  readonly systemPrompt?: string;
  /** Name of an environment variable containing a local endpoint token. */
  readonly apiKeyEnv?: string;
  readonly mcpServers?: McpServerConfigurations;
}

export interface HarnessConfiguration extends ProfileConfiguration {
  readonly defaultProfile?: string;
  readonly profiles?: Readonly<Record<string, ProfileConfiguration>>;
  /** User-level opt-in for executable MCP definitions from workspace configuration. */
  readonly allowWorkspaceMcpServers?: boolean;
}

export interface ConfigurationOverrides extends ProfileConfiguration {
  readonly profile?: string;
}

export interface ResolvedConfiguration extends ClientConfiguration {
  readonly profile?: string;
  readonly permission: PermissionMode;
  readonly paths: { readonly user: string; readonly workspace: string };
}

export interface ConfigurationPaths {
  readonly user: string;
  readonly workspace: string;
}

function validProvider(value: unknown): LocalEndpointKind | undefined {
  return value === "ollama" || value === "openai-compatible" ? value : undefined;
}

function validMode(value: unknown): AgentMode | undefined {
  return value === "chat" || value === "plan" || value === "edit" ? value : undefined;
}

function validPermission(value: unknown): PermissionMode | undefined {
  return value === "ask" || value === "auto-read" || value === "auto-all" ? value : undefined;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function parseProfile(value: unknown): ProfileConfiguration {
  const source = object(value);
  if (!source) return {};
  return {
    provider: validProvider(source.provider),
    baseUrl: typeof source.baseUrl === "string" ? source.baseUrl : undefined,
    model: typeof source.model === "string" ? source.model : undefined,
    mode: validMode(source.mode),
    permission: validPermission(source.permission),
    internetAccess: typeof source.internetAccess === "boolean" ? source.internetAccess : undefined,
    systemPrompt: typeof source.systemPrompt === "string" ? source.systemPrompt : undefined,
    apiKeyEnv: typeof source.apiKeyEnv === "string" ? source.apiKeyEnv : undefined,
    mcpServers: source.mcpServers === undefined ? undefined : parseMcpServerConfigurations(source.mcpServers)
  };
}

function parseConfiguration(value: unknown): HarnessConfiguration {
  const source = object(value);
  if (!source) throw new Error("Configuration root must be a JSON object.");
  const profilesSource = object(source.profiles);
  const profiles = profilesSource
    ? Object.fromEntries(Object.entries(profilesSource).map(([name, profile]) => [name, parseProfile(profile)]))
    : undefined;
  return {
    ...parseProfile(source),
    defaultProfile: typeof source.defaultProfile === "string" ? source.defaultProfile : undefined,
    profiles,
    allowWorkspaceMcpServers: source.allowWorkspaceMcpServers === true
  };
}

async function readConfiguration(path: string): Promise<HarnessConfiguration> {
  try {
    return parseConfiguration(JSON.parse(await readFile(path, "utf8")) as unknown);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return {};
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read ${brand.productName} configuration at ${path}: ${message}`);
  }
}

function environmentConfiguration(environment: NodeJS.ProcessEnv): ProfileConfiguration {
  let mcpServers: McpServerConfigurations | undefined;
  if (environment.TRUSS_HARNESS_MCP_SERVERS) {
    try {
      mcpServers = parseMcpServerConfigurations(JSON.parse(environment.TRUSS_HARNESS_MCP_SERVERS) as unknown);
    } catch (error) {
      throw new Error(`TRUSS_HARNESS_MCP_SERVERS must contain valid MCP server JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return {
    provider: validProvider(environment.TRUSS_HARNESS_PROVIDER),
    baseUrl: environment.TRUSS_HARNESS_BASE_URL,
    model: environment.TRUSS_HARNESS_MODEL,
    mode: validMode(environment.TRUSS_HARNESS_AGENT_MODE),
    permission: validPermission(environment.TRUSS_HARNESS_PERMISSION_MODE),
    internetAccess: environment.TRUSS_HARNESS_INTERNET_ACCESS === undefined
      ? undefined
      : environment.TRUSS_HARNESS_INTERNET_ACCESS === "true" || environment.TRUSS_HARNESS_INTERNET_ACCESS === "1",
    systemPrompt: environment.TRUSS_HARNESS_SYSTEM_PROMPT,
    apiKeyEnv: environment.TRUSS_HARNESS_API_KEY ? "TRUSS_HARNESS_API_KEY" : undefined,
    mcpServers
  };
}

const profileKeys = [
  "provider",
  "baseUrl",
  "model",
  "mode",
  "permission",
  "internetAccess",
  "systemPrompt",
  "apiKeyEnv",
  "mcpServers"
] as const satisfies readonly (keyof ProfileConfiguration)[];

function mergeProfiles(...sources: readonly (ProfileConfiguration | undefined)[]): ProfileConfiguration {
  const merged: Record<string, unknown> = {};
  for (const source of sources) {
    if (!source) continue;
    for (const key of profileKeys) {
      const value = source[key];
      if (value !== undefined) merged[key] = value;
    }
  }
  return merged as ProfileConfiguration;
}

export function configurationPaths(workspaceRoot: string, environment: NodeJS.ProcessEnv = process.env): ConfigurationPaths {
  const userRoot = process.platform === "win32"
    ? environment.APPDATA ?? join(homedir(), "AppData", "Roaming")
    : environment.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return {
    user: join(userRoot, brand.productSlug, "config.json"),
    workspace: join(workspaceRoot, brand.workspaceDirectory, "config.json")
  };
}

export async function resolveConfiguration(options: {
  readonly workspaceRoot: string;
  readonly overrides?: ConfigurationOverrides;
  readonly environment?: NodeJS.ProcessEnv;
  readonly paths?: ConfigurationPaths;
}): Promise<ResolvedConfiguration> {
  const environment = options.environment ?? process.env;
  const paths = options.paths ?? configurationPaths(options.workspaceRoot, environment);
  const [user, workspace] = await Promise.all([readConfiguration(paths.user), readConfiguration(paths.workspace)]);
  const profile = options.overrides?.profile ?? workspace.defaultProfile ?? user.defaultProfile ?? environment.TRUSS_HARNESS_PROFILE;
  const userProfile = profile ? user.profiles?.[profile] : undefined;
  const workspaceProfile = profile ? workspace.profiles?.[profile] : undefined;
  const environmentProfile = environmentConfiguration(environment);
  const merged = mergeProfiles(environmentProfile, user, userProfile, workspace, workspaceProfile, options.overrides);
  const workspaceMcpServers = user.allowWorkspaceMcpServers
    ? workspaceProfile?.mcpServers ?? workspace.mcpServers
    : undefined;
  const mcpServers = options.overrides?.mcpServers
    ?? workspaceMcpServers
    ?? userProfile?.mcpServers
    ?? user.mcpServers
    ?? environmentProfile.mcpServers;
  let provider = merged.provider ?? "ollama";
  let baseUrl = merged.baseUrl;
  let model = merged.model;
  if (!model) {
    const hasConfiguredEndpoint = merged.provider !== undefined || baseUrl !== undefined;
    const configuredEndpoint = hasConfiguredEndpoint ? [{
      id: "configured",
      label: "Configured endpoint",
      kind: provider,
      baseUrl: baseUrl ?? (provider === "ollama" ? "http://127.0.0.1:11434" : "http://127.0.0.1:1234/v1")
    }] : undefined;
    const detected = await detectActiveLocalModel({ endpoints: configuredEndpoint });
    if (detected) {
      provider = detected.endpoint.kind;
      baseUrl = detected.endpoint.baseUrl;
      model = detected.model.name;
    }
  }
  if (!model) throw new Error(`Set a model with --model, TRUSS_HARNESS_MODEL, a ${brand.productName} config profile, or start a local model server.`);
  const apiKey = merged.apiKeyEnv ? environment[merged.apiKeyEnv] : undefined;
  return {
    workspaceRoot: options.workspaceRoot,
    provider,
    baseUrl: baseUrl ?? (provider === "ollama" ? "http://127.0.0.1:11434" : "http://127.0.0.1:1234/v1"),
    model,
    mode: merged.mode ?? "chat",
    permission: merged.permission ?? "ask",
    internetAccess: merged.internetAccess ?? false,
    apiKey,
    systemPrompt: merged.systemPrompt,
    mcpServers,
    profile,
    paths
  };
}

export async function initializeWorkspaceConfiguration(workspaceRoot: string, paths = configurationPaths(workspaceRoot)): Promise<string> {
  try {
    await access(paths.workspace);
    throw new Error(`Configuration already exists at ${paths.workspace}`);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  await mkdir(dirname(paths.workspace), { recursive: true });
  await writeFile(paths.workspace, `${JSON.stringify({
    defaultProfile: "ollama",
    profiles: {
      ollama: {
        provider: "ollama",
        baseUrl: "http://127.0.0.1:11434",
        model: "qwen3:8b",
        mode: "edit",
        permission: "ask",
        internetAccess: false
      },
      "lm-studio": {
        provider: "openai-compatible",
        baseUrl: "http://127.0.0.1:1234/v1",
        model: "local-model-id",
        mode: "plan",
        permission: "auto-read"
      }
    },
    mcpServers: {
      filesystem: {
        enabled: false,
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
        readOnly: false
      }
    }
  }, null, 2)}\n`, "utf8");
  return paths.workspace;
}

export function parseConfigurationOverrides(arguments_: readonly string[]): { readonly overrides: ConfigurationOverrides; readonly rest: readonly string[] } {
  const overrides: { profile?: string; provider?: LocalEndpointKind; baseUrl?: string; model?: string; mode?: AgentMode; permission?: PermissionMode; internetAccess?: boolean } = {};
  const rest: string[] = [];
  for (let index = 0; index < arguments_.length; index++) {
    const argument = arguments_[index];
    const value = (): string => {
      const next = arguments_[++index];
      if (!next || next.startsWith("--")) throw new Error(`Missing value for ${argument}`);
      return next;
    };
    if (argument === "--profile") overrides.profile = value();
    else if (argument === "--provider") {
      const provider = validProvider(value());
      if (!provider) throw new Error("--provider must be ollama or openai-compatible");
      overrides.provider = provider;
    } else if (argument === "--base-url") overrides.baseUrl = value();
    else if (argument === "--model") overrides.model = value();
    else if (argument === "--mode") {
      const mode = validMode(value());
      if (!mode) throw new Error("--mode must be chat, plan, or edit");
      overrides.mode = mode;
    } else if (argument === "--permission") {
      const permission = validPermission(value());
      if (!permission) throw new Error("--permission must be ask, auto-read, or auto-all");
      overrides.permission = permission;
    } else if (argument === "--internet-access") {
      overrides.internetAccess = true;
    } else if (argument === "--no-internet-access") {
      overrides.internetAccess = false;
    } else rest.push(argument);
  }
  return { overrides, rest };
}
