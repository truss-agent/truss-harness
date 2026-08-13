import { readFile, writeFile } from "node:fs/promises";
import { isProviderAccount } from "@truss-harness/runtime";
import type { DesktopState, DesktopThemePreference } from "../shared.js";
import {
  isConfiguration,
  isThemePreference,
  normalizeConfiguration,
  normalizeWorkspaceUiState,
} from "./desktop-configuration.js";

const defaultTheme: DesktopThemePreference = { name: "default" };

export function defaultDesktopState(workspaceRoot: string): DesktopState {
  return {
    workspaceRoot,
    zoomFactor: 1,
    updates: { checkOnLaunch: true, autoDownload: false },
    theme: defaultTheme,
    conversations: [],
  };
}

export class DesktopStateStore {
  constructor(
    private readonly path: string,
    private readonly fallbackWorkspaceRoot: string,
  ) {}

  async load(): Promise<DesktopState> {
    try {
      const parsed = JSON.parse(
        await readFile(this.path, "utf8"),
      ) as Partial<DesktopState>;
      return {
        workspaceRoot:
          typeof parsed.workspaceRoot === "string"
            ? parsed.workspaceRoot
            : this.fallbackWorkspaceRoot,
        zoomFactor:
          typeof parsed.zoomFactor === "number" &&
          Number.isFinite(parsed.zoomFactor)
            ? Math.min(2, Math.max(0.7, parsed.zoomFactor))
            : 1,
        configuration: isConfiguration(parsed.configuration)
          ? normalizeConfiguration(parsed.configuration)
          : undefined,
        providerAccounts: Array.isArray(parsed.providerAccounts)
          ? parsed.providerAccounts.filter(isProviderAccount)
          : [],
        updates:
          parsed.updates && typeof parsed.updates === "object"
            ? {
                checkOnLaunch:
                  (parsed.updates as { checkOnLaunch?: unknown })
                    .checkOnLaunch !== false,
                autoDownload:
                  (parsed.updates as { autoDownload?: unknown })
                    .autoDownload === true,
              }
            : { checkOnLaunch: true, autoDownload: false },
        theme: isThemePreference(parsed.theme) ? parsed.theme : defaultTheme,
        conversations: Array.isArray(parsed.conversations)
          ? parsed.conversations.slice(0, 30)
          : [],
        activeConversationId:
          typeof parsed.activeConversationId === "string"
            ? parsed.activeConversationId
            : undefined,
        workspaceUiState: normalizeWorkspaceUiState(parsed.workspaceUiState),
        agentProfiles: Array.isArray(parsed.agentProfiles)
          ? parsed.agentProfiles
          : undefined,
      };
    } catch {
      return defaultDesktopState(this.fallbackWorkspaceRoot);
    }
  }

  async save(state: DesktopState): Promise<void> {
    await writeFile(this.path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }
}
