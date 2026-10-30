import { parseMcpServerConfigurations } from "@truss-harness/mcp";
import {
  type CloudProviderId,
  cloudProviderDefinition,
  isCloudProviderId,
  isLocalEndpointKind,
  type LocalModelEndpoint,
  publishedContextWindow,
} from "@truss-harness/provider-openai-compatible";
import { validateMasterPrompt } from "@truss-harness/runtime";
import {
  type DesktopConfiguration,
  type DesktopModelInfo,
  type DesktopThemePalette,
  type DesktopThemePreference,
  type DesktopWorkspaceUiState,
  desktopThemeNames,
} from "../shared.js";

export {
  modelInfoFromRecord,
  publishedContextWindow,
  usableChatModels,
} from "@truss-harness/provider-openai-compatible";

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
    (candidate.masterPrompt === undefined ||
      (typeof candidate.masterPrompt === "object" &&
        candidate.masterPrompt !== null &&
        typeof candidate.masterPrompt.template === "string" &&
        (candidate.masterPrompt.enabled === undefined ||
          typeof candidate.masterPrompt.enabled === "boolean"))) &&
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
  const normalized = {
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
    masterPrompt:
      value.masterPrompt && typeof value.masterPrompt.template === "string"
        ? {
            enabled: value.masterPrompt.enabled !== false,
            template: value.masterPrompt.template,
          }
        : undefined,
    autocomplete: {
      enabled: value.autocomplete?.enabled ?? false,
      model: value.autocomplete?.model?.trim() || undefined,
    },
    formatOnSave: value.formatOnSave === true,
    mcpServers: parseMcpServerConfigurations(value.mcpServers),
  };
  const masterPromptValidation = validateMasterPrompt(normalized.masterPrompt);
  if (!masterPromptValidation.valid) {
    throw new Error(masterPromptValidation.errors.join(" "));
  }
  return normalized;
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
