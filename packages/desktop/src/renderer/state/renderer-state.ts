import type {
  DesktopConfiguration,
  DesktopConversation,
  DesktopCredentialStorage,
  DesktopModelInfo,
  DesktopState,
} from "../../shared.js";

export const defaultDesktopConfiguration: DesktopConfiguration = {
  provider: "ollama",
  baseUrl: "http://127.0.0.1:11434",
  model: "",
  mode: "chat",
  permission: "ask",
  contextWindow: 8_192,
  internetAccess: false,
  autocomplete: { enabled: false },
  formatOnSave: false,
  mcpServers: {},
};

export const initialDesktopState: DesktopState = {
  workspaceRoot: "",
  zoomFactor: 1,
  updates: { checkOnLaunch: true, autoDownload: false },
  theme: { name: "default" },
  conversations: [],
};

/** Owns renderer data that is shared across otherwise independent UI domains. */
export class RendererStateStore {
  private currentDesktop: DesktopState;
  private currentCredentialStorage: DesktopCredentialStorage = "secure";
  private localModels: readonly DesktopModelInfo[] = [];
  private cloudModels: readonly DesktopModelInfo[] = [];

  constructor(initial: DesktopState = initialDesktopState) {
    this.currentDesktop = initial;
  }

  get desktop(): DesktopState {
    return this.currentDesktop;
  }

  set desktop(state: DesktopState) {
    this.currentDesktop = state;
  }

  replaceDesktop(state: DesktopState): void {
    this.currentDesktop = state;
  }

  updateDesktop(update: (state: DesktopState) => DesktopState): DesktopState {
    this.currentDesktop = update(this.currentDesktop);
    return this.currentDesktop;
  }

  get credentialStorage(): DesktopCredentialStorage {
    return this.currentCredentialStorage;
  }

  set credentialStorage(storage: DesktopCredentialStorage) {
    this.currentCredentialStorage = storage;
  }

  setCredentialStorage(storage: DesktopCredentialStorage): void {
    this.currentCredentialStorage = storage;
  }

  configuration(): DesktopConfiguration {
    return this.currentDesktop.configuration ?? defaultDesktopConfiguration;
  }

  activeConversation(): DesktopConversation | undefined {
    return this.conversation(this.currentDesktop.activeConversationId);
  }

  conversation(id: string | undefined): DesktopConversation | undefined {
    return this.currentDesktop.conversations.find(
      (conversation) => conversation.id === id,
    );
  }

  setModels(
    kind: "local" | "cloud",
    models: readonly DesktopModelInfo[],
  ): void {
    if (kind === "local") this.localModels = models;
    else this.cloudModels = models;
  }

  models(kind: "local" | "cloud"): readonly DesktopModelInfo[] {
    return kind === "local" ? this.localModels : this.cloudModels;
  }

  knownModel(
    modelId = this.configuration().model,
  ): DesktopModelInfo | undefined {
    return [...this.localModels, ...this.cloudModels].find(
      (model) => model.id === modelId,
    );
  }
}
