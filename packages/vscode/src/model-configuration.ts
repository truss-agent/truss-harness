import type { McpServerConfigurations } from "@truss-harness/mcp";
import type { MasterPromptConfiguration } from "@truss-harness/runtime";
import {
  cloudProviderDefinition,
  isCloudProviderId,
  isLocalEndpointKind,
  type LocalModelEndpoint,
  type ModelProviderKind,
  normalizeLocalBaseUrl,
} from "@truss-harness/provider-openai-compatible";
import type { DiscoveredModel, ModelConfiguration } from "./contracts.js";

export const defaultConfiguration: ModelConfiguration = {
  provider: "ollama",
  baseUrl: "http://127.0.0.1:11434",
  model: "",
  mode: "chat",
  permission: "ask",
  contextWindow: 8_192,
  internetAccess: false,
  mcpServers: {},
};

function masterPromptConfiguration(
  value: unknown,
): MasterPromptConfiguration | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const candidate = value as Partial<MasterPromptConfiguration>;
  if (typeof candidate.template !== "string") return undefined;
  return { enabled: candidate.enabled !== false, template: candidate.template };
}

function finiteNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

export function discoveredModel(
  value: unknown,
  provider: ModelProviderKind,
): DiscoveredModel | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const record = value as Record<string, unknown>;
  const id = [record.id, record.name, record.model].find(
    (candidate): candidate is string =>
      typeof candidate === "string" && candidate.trim().length > 0,
  );
  if (!id) return undefined;
  const contextWindow = [
    record.context_length,
    record.max_context_length,
    record.contextWindow,
    record.max_input_tokens,
    record.inputTokenLimit,
  ].find(
    (candidate): candidate is number =>
      typeof candidate === "number" &&
      Number.isFinite(candidate) &&
      candidate >= 512,
  );
  const pricing = record.pricing as Record<string, unknown> | undefined;
  const inputCostPerToken = finiteNonNegativeNumber(
    pricing?.prompt ??
      pricing?.input ??
      record.input_cost_per_token ??
      record.inputCostPerToken,
  );
  const outputCostPerToken = finiteNonNegativeNumber(
    pricing?.completion ??
      pricing?.output ??
      record.output_cost_per_token ??
      record.outputCostPerToken,
  );
  const costMultiplier = provider === "openrouter" ? 1_000_000 : 1;
  return {
    id: id.trim(),
    ...(contextWindow ? { contextWindow: Math.floor(contextWindow) } : {}),
    ...(inputCostPerToken !== undefined
      ? { inputCostPerMillion: inputCostPerToken * costMultiplier }
      : {}),
    ...(outputCostPerToken !== undefined
      ? { outputCostPerMillion: outputCostPerToken * costMultiplier }
      : {}),
  };
}

export function localEndpoint(
  configuration: ModelConfiguration & {
    readonly provider: "ollama" | "openai-compatible";
  },
): LocalModelEndpoint {
  return {
    id: "configured",
    label: "Configured endpoint",
    kind: configuration.provider,
    baseUrl: configuration.baseUrl,
  };
}

export function isLocalConfiguration(
  configuration: ModelConfiguration,
): configuration is ModelConfiguration & {
  readonly provider: "ollama" | "openai-compatible";
} {
  return isLocalEndpointKind(configuration.provider);
}

export function isConfiguration(
  value: unknown,
): value is Omit<
  ModelConfiguration,
  "mode" | "permission" | "contextWindow" | "internetAccess" | "mcpServers"
> &
  Partial<
    Pick<
      ModelConfiguration,
      "mode" | "permission" | "contextWindow" | "internetAccess" | "mcpServers"
    >
  > {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ModelConfiguration>;
  return (
    (isLocalEndpointKind(candidate.provider) ||
      isCloudProviderId(candidate.provider)) &&
    typeof candidate.baseUrl === "string" &&
    typeof candidate.model === "string"
  );
}

export function normalizeConfiguration(value: unknown): ModelConfiguration {
  if (!isConfiguration(value)) return defaultConfiguration;
  return {
    provider: value.provider,
    baseUrl: isLocalEndpointKind(value.provider)
      ? normalizeLocalBaseUrl(value.provider, value.baseUrl)
      : cloudProviderDefinition(value.provider).baseUrl,
    model: value.model,
    ...(typeof value.credentialAccountId === "string" &&
    value.credentialAccountId.trim()
      ? { credentialAccountId: value.credentialAccountId.trim() }
      : {}),
    mode: value.mode === "plan" || value.mode === "edit" ? value.mode : "chat",
    permission:
      value.permission === "auto-read" || value.permission === "auto-all"
        ? value.permission
        : "ask",
    contextWindow:
      typeof value.contextWindow === "number" &&
      Number.isFinite(value.contextWindow)
        ? Math.max(512, Math.min(1_000_000, Math.floor(value.contextWindow)))
        : defaultConfiguration.contextWindow,
    internetAccess: value.internetAccess === true,
    masterPrompt: masterPromptConfiguration(value.masterPrompt),
    mcpServers: normalizeMcpServers(value.mcpServers),
  };
}

export function normalizeMcpServers(value: unknown): McpServerConfigurations {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([name, item]) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const source = item as Record<string, unknown>;
      if (typeof source.command !== "string" || !source.command.trim())
        return [];
      const args =
        Array.isArray(source.args) &&
        source.args.every((argument) => typeof argument === "string")
          ? (source.args as string[])
          : undefined;
      const env =
        source.env &&
        typeof source.env === "object" &&
        !Array.isArray(source.env) &&
        Object.values(source.env).every((entry) => typeof entry === "string")
          ? (source.env as Record<string, string>)
          : undefined;
      return [
        [
          name,
          {
            command: source.command,
            args,
            cwd: typeof source.cwd === "string" ? source.cwd : undefined,
            env,
            enabled: source.enabled !== false,
            readOnly: source.readOnly === true,
          },
        ],
      ];
    }),
  );
}

export async function releaseOllamaModel(
  configuration: ModelConfiguration,
): Promise<void> {
  if (configuration.provider !== "ollama" || !configuration.model) return;
  try {
    await fetch(`${configuration.baseUrl.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: configuration.model, keep_alive: 0 }),
      signal: AbortSignal.timeout(2_000),
    });
  } catch {
    // Releasing an idle local model is best-effort and must not block configuration changes.
  }
}
