import { parseMcpServerConfigurations } from "@truss-harness/mcp";
import {
  type CloudProviderId,
  cloudProviderDefinition,
  isCloudProviderId,
  isLocalEndpointKind,
  type LocalModelEndpoint,
} from "@truss-harness/provider-openai-compatible";
import {
  type DesktopConfiguration,
  type DesktopModelInfo,
  type DesktopThemePalette,
  type DesktopThemePreference,
  type DesktopWorkspaceUiState,
  desktopThemeNames,
} from "../shared.js";

export function publishedContextWindow(
  provider: CloudProviderId,
  modelId: string,
): number | undefined {
  if (provider !== "openai") return undefined;
  const normalized = modelId.toLowerCase();
  return ["gpt-5.6", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"].includes(
    normalized,
  )
    ? 1_050_000
    : undefined;
}

export function isConfiguration(value: unknown): value is DesktopConfiguration {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DesktopConfiguration>;
  return (
    (isLocalEndpointKind(candidate.provider) ||
      isCloudProviderId(candidate.provider)) &&
    typeof candidate.baseUrl === "string" &&
    typeof candidate.model === "string" &&
    (candidate.mode === "chat" ||
      candidate.mode === "plan" ||
      candidate.mode === "edit") &&
    (candidate.permission === "ask" ||
      candidate.permission === "auto-read" ||
      candidate.permission === "auto-all") &&
    typeof candidate.contextWindow === "number" &&
    (candidate.modelContextWindow === undefined ||
      typeof candidate.modelContextWindow === "number") &&
    (candidate.internetAccess === undefined ||
      typeof candidate.internetAccess === "boolean") &&
    (candidate.credentialAccountId === undefined ||
      typeof candidate.credentialAccountId === "string")
  );
}

export function normalizeConfiguration(
  value: DesktopConfiguration,
): DesktopConfiguration {
  const modelContextWindow = isCloudProviderId(value.provider)
    ? (value.modelContextWindow ??
      publishedContextWindow(value.provider, value.model))
    : undefined;
  return {
    ...value,
    baseUrl: isCloudProviderId(value.provider)
      ? cloudProviderDefinition(value.provider).baseUrl
      : value.baseUrl.trim(),
    model: value.model.trim(),
    credentialAccountId: isCloudProviderId(value.provider)
      ? value.credentialAccountId?.trim() || undefined
      : undefined,
    contextWindow: Math.max(
      512,
      Math.min(2_000_000, Math.floor(value.contextWindow || 8_192)),
    ),
    modelContextWindow:
      modelContextWindow === undefined
        ? undefined
        : Math.max(512, Math.min(2_000_000, Math.floor(modelContextWindow))),
    internetAccess: value.internetAccess ?? false,
    autocomplete: {
      enabled: value.autocomplete?.enabled ?? false,
      model: value.autocomplete?.model?.trim() || undefined,
    },
    formatOnSave: value.formatOnSave === true,
    mcpServers: parseMcpServerConfigurations(value.mcpServers),
  };
}

export function isLocalConfiguration(
  configuration: DesktopConfiguration,
): configuration is DesktopConfiguration & {
  readonly provider: "ollama" | "openai-compatible";
} {
  return isLocalEndpointKind(configuration.provider);
}

export function contextBudgetForConfiguration(
  configuration: DesktopConfiguration,
): number {
  return isLocalConfiguration(configuration)
    ? configuration.contextWindow
    : (configuration.modelContextWindow ?? 8_192);
}

export function normalizeWorkspaceUiState(
  value: unknown,
): DesktopWorkspaceUiState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<DesktopWorkspaceUiState>;
  const expandedDirectories = Array.isArray(candidate.expandedDirectories)
    ? candidate.expandedDirectories.filter(
        (path): path is string => typeof path === "string",
      )
    : [];
  const openEditors = Array.isArray(candidate.openEditors)
    ? candidate.openEditors.flatMap((editor) =>
        editor &&
        typeof editor === "object" &&
        typeof editor.path === "string" &&
        (editor.mode === "file" || editor.mode === "diff")
          ? [
              {
                path: editor.path,
                mode: editor.mode,
                scrollTop:
                  typeof editor.scrollTop === "number" &&
                  Number.isFinite(editor.scrollTop)
                    ? Math.max(0, editor.scrollTop)
                    : 0,
              },
            ]
          : [],
      )
    : [];
  return {
    expandedDirectories,
    openEditors,
    activeFile:
      typeof candidate.activeFile === "string"
        ? candidate.activeFile
        : undefined,
    fileTreeScrollTop:
      typeof candidate.fileTreeScrollTop === "number" &&
      Number.isFinite(candidate.fileTreeScrollTop)
        ? Math.max(0, candidate.fileTreeScrollTop)
        : 0,
  };
}

function isColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function isThemePalette(value: unknown): value is DesktopThemePalette {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every(isColor);
}

export function isThemePreference(
  value: unknown,
): value is DesktopThemePreference {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DesktopThemePreference>;
  return (
    typeof candidate.name === "string" &&
    desktopThemeNames.includes(
      candidate.name as DesktopThemePreference["name"],
    ) &&
    (candidate.custom === undefined || isThemePalette(candidate.custom))
  );
}

export function localEndpoint(
  configuration: Pick<DesktopConfiguration, "baseUrl"> & {
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

function finiteNumber(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function modelKind(value: unknown): DesktopModelInfo["kind"] {
  if (typeof value !== "string") return undefined;
  const normalized = value.toLowerCase();
  if (normalized.includes("embed")) return "embedding";
  if (normalized.includes("moderation")) return "moderation";
  if (normalized.includes("image")) return "image";
  if (normalized.includes("audio") || normalized.includes("speech"))
    return "audio";
  if (normalized.includes("chat") || normalized.includes("language"))
    return "chat";
  return "other";
}

export function modelInfoFromRecord(
  value: unknown,
  provider: CloudProviderId,
): DesktopModelInfo | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  const id = [source.id, source.name, source.model]
    .find(
      (candidate): candidate is string =>
        typeof candidate === "string" && Boolean(candidate.trim()),
    )
    ?.trim();
  if (!id || source.archived === true) return undefined;
  const capabilities = source.capabilities as
    | Record<string, unknown>
    | undefined;
  const supportedParameters = Array.isArray(source.supported_parameters)
    ? source.supported_parameters.filter(
        (item): item is string => typeof item === "string",
      )
    : [];
  const supportedGenerationMethods = Array.isArray(
    source.supportedGenerationMethods,
  )
    ? source.supportedGenerationMethods.filter(
        (item): item is string => typeof item === "string",
      )
    : [];
  const kind =
    modelKind(source.type) ??
    modelKind(source.kind) ??
    (/(?:embedding|moderation|rerank|whisper|tts|dall-e|image-generation)/i.test(
      id,
    )
      ? modelKind(id)
      : undefined);
  const pricing = source.pricing as Record<string, unknown> | undefined;
  const inputPrice = finiteNumber(
    pricing?.prompt ??
      pricing?.input ??
      source.input_cost_per_token ??
      source.inputCostPerToken,
  );
  const outputPrice = finiteNumber(
    pricing?.completion ??
      pricing?.output ??
      source.output_cost_per_token ??
      source.outputCostPerToken,
  );
  const pricingMultiplier = provider === "openrouter" ? 1_000_000 : 1;
  const supportsTools =
    supportedParameters.some((item) =>
      ["tools", "tool_choice", "function_calling"].includes(item),
    ) || capabilities?.function_calling === true;
  const contextWindow =
    finiteNumber(
      source.context_length ??
        source.max_context_length ??
        source.contextWindow ??
        source.inputTokenLimit ??
        source.max_input_tokens,
    ) ?? publishedContextWindow(provider, id);
  return {
    id,
    ...(contextWindow ? { contextWindow } : {}),
    ...(inputPrice !== undefined
      ? { inputCostPerMillion: inputPrice * pricingMultiplier }
      : {}),
    ...(outputPrice !== undefined
      ? { outputCostPerMillion: outputPrice * pricingMultiplier }
      : {}),
    ...(kind ? { kind } : {}),
    ...(supportsTools || supportedGenerationMethods.includes("generateContent")
      ? { supportsTools: true }
      : {}),
  };
}

export function usableChatModels(
  models: readonly DesktopModelInfo[],
): DesktopModelInfo[] {
  return models.filter(
    (model) =>
      model.kind !== "embedding" &&
      model.kind !== "image" &&
      model.kind !== "audio" &&
      model.kind !== "moderation",
  );
}
