function requiredElement<T extends HTMLElement>(
  document: Document,
  id: string,
): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required settings element #${id}.`);
  return element as T;
}

/** Resolves the settings domain DOM once at renderer composition time. */
export function desktopSettingsElements(document: Document) {
  const element = <T extends HTMLElement>(id: string): T =>
    requiredElement<T>(document, id);
  return {
    settingsPanel: element<HTMLElement>("settingsPanel"),
    endpointSelect: element<HTMLSelectElement>("endpointSelect"),
    providerSelect: element<HTMLSelectElement>("providerSelect"),
    byokProviderSelect: element<HTMLSelectElement>("byokProviderSelect"),
    baseUrlInput: element<HTMLInputElement>("baseUrlInput"),
    modelInput: element<HTMLInputElement>("modelInput"),
    byokBaseUrl: element<HTMLInputElement>("byokBaseUrl"),
    byokModelSelect: element<HTMLSelectElement>("byokModelSelect"),
    byokModelInput: element<HTMLInputElement>("byokModelInput"),
    providerAccountSelect: element<HTMLSelectElement>("providerAccountSelect"),
    providerAccountLabel: element<HTMLInputElement>("providerAccountLabel"),
    newProviderAccount: element<HTMLButtonElement>("newProviderAccount"),
    saveProviderAccount: element<HTMLButtonElement>("saveProviderAccount"),
    deleteProviderAccount: element<HTMLButtonElement>("deleteProviderAccount"),
    discoverByokModels: element<HTMLButtonElement>("discoverByokModels"),
    apiKeyInput: element<HTMLInputElement>("apiKeyInput"),
    clearApiKey: element<HTMLButtonElement>("clearApiKey"),
    testProviderConnection: element<HTMLButtonElement>(
      "testProviderConnection",
    ),
    providerConnectionResult: element<HTMLParagraphElement>(
      "providerConnectionResult",
    ),
    credentialStorageStatus: element<HTMLParagraphElement>(
      "credentialStorageStatus",
    ),
    modelOptions: element<HTMLDataListElement>("modelOptions"),
    contextInput: element<HTMLInputElement>("contextInput"),
    permissionSelect: element<HTMLSelectElement>("permissionSelect"),
    internetAccessInput: element<HTMLInputElement>("internetAccessInput"),
    autocompleteEnabled: element<HTMLInputElement>("autocompleteEnabled"),
    autocompleteModel: element<HTMLInputElement>("autocompleteModel"),
    formatOnSave: element<HTMLInputElement>("formatOnSave"),
    masterPromptEnabled: element<HTMLInputElement>("masterPromptEnabled"),
    masterPromptTemplate: element<HTMLTextAreaElement>("masterPromptTemplate"),
    mcpServersInput: element<HTMLTextAreaElement>("mcpServersInput"),
    mcpStatus: element<HTMLDivElement>("mcpStatus"),
    mcpServerList: element<HTMLDivElement>("mcpServerList"),
    mcpServerEditor: element<HTMLElement>("mcpServerEditor"),
    mcpEditorTitle: element<HTMLElement>("mcpEditorTitle"),
    mcpNameInput: element<HTMLInputElement>("mcpNameInput"),
    mcpCommandInput: element<HTMLInputElement>("mcpCommandInput"),
    mcpArgsInput: element<HTMLTextAreaElement>("mcpArgsInput"),
    mcpCwdInput: element<HTMLInputElement>("mcpCwdInput"),
    mcpEnabledInput: element<HTMLInputElement>("mcpEnabledInput"),
    mcpReadOnlyInput: element<HTMLInputElement>("mcpReadOnlyInput"),
    checkUpdatesOnLaunch: element<HTMLInputElement>("checkUpdatesOnLaunch"),
    autoDownloadUpdates: element<HTMLInputElement>("autoDownloadUpdates"),
    themeSelect: element<HTMLSelectElement>("themeSelect"),
    customThemeSetting: element<HTMLElement>("customThemeSetting"),
    customThemeInput: element<HTMLTextAreaElement>("customThemeInput"),
    customThemeHelp: element<HTMLDivElement>("customThemeHelp"),
    customThemeActions: element<HTMLDivElement>("customThemeActions"),
    saveCustomTheme: element<HTMLButtonElement>("saveCustomTheme"),
    updateStatus: element<HTMLSpanElement>("updateStatus"),
    checkUpdates: element<HTMLButtonElement>("checkUpdates"),
    downloadUpdate: element<HTMLButtonElement>("downloadUpdate"),
    installUpdate: element<HTMLButtonElement>("installUpdate"),
    updateAvailableDialog: element<HTMLDialogElement>("updateAvailableDialog"),
    updateAvailableMessage: element<HTMLElement>("updateAvailableMessage"),
    openUpdateSettings: element<HTMLButtonElement>("openUpdateSettings"),
  };
}
