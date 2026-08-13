export type EditorTabMode = "file" | "diff" | "settings";
export type EditorTabState = "loading" | "ready" | "error";

export interface EditorTab {
  readonly path: string;
  mode: EditorTabMode;
  state: EditorTabState;
  content: string;
  dirty: boolean;
  scrollTop: number;
  revision: number;
}

export interface SyntaxDiagnostic {
  readonly line: number;
  readonly message: string;
}

export interface PersistedEditor {
  readonly path: string;
  readonly mode: "file" | "diff";
  readonly scrollTop: number;
}

export function editorPath(path: string): string {
  return path.replaceAll("\\", "/");
}

/** Owns editor tabs, active selection, persistence, and syntax state. */
export class DesktopEditorController {
  readonly tabs: EditorTab[] = [];
  readonly syntaxDiagnostics = new Map<string, readonly SyntaxDiagnostic[]>();
  activePath: string | undefined;

  constructor(readonly settingsPath: string) {}

  get showingDiff(): boolean {
    return this.activeTab()?.mode === "diff";
  }

  activeTab(): EditorTab | undefined {
    return this.activePath
      ? this.tabs.find((tab) => tab.path === this.activePath)
      : undefined;
  }

  activeWorkspacePath(): string | undefined {
    return this.activeTab()?.mode === "settings" ? undefined : this.activePath;
  }

  select(tab: EditorTab): void {
    this.activePath = tab.path;
  }

  find(path: string): EditorTab | undefined {
    const normalized = editorPath(path);
    return this.tabs.find((tab) => tab.path === normalized);
  }

  add(path: string, mode: EditorTabMode, state: EditorTabState): EditorTab {
    const tab: EditorTab = {
      path: editorPath(path),
      mode,
      state,
      content: "",
      dirty: false,
      scrollTop: 0,
      revision: 0,
    };
    this.tabs.push(tab);
    return tab;
  }

  close(path: string): {
    readonly wasActive: boolean;
    readonly next?: EditorTab;
  } {
    const normalized = editorPath(path);
    const index = this.tabs.findIndex((tab) => tab.path === normalized);
    if (index < 0) return { wasActive: false };
    const wasActive = this.activePath === normalized;
    this.tabs.splice(index, 1);
    if (!wasActive) return { wasActive };
    const next = this.tabs[Math.min(index, this.tabs.length - 1)];
    this.activePath = undefined;
    return { wasActive, next };
  }

  removeEntries(
    path: string,
    includeChildren: boolean,
  ): { readonly removedActive: boolean; readonly next?: EditorTab } {
    const normalized = editorPath(path);
    const prefix = `${normalized}/`;
    const removedActive =
      this.activePath === normalized ||
      (includeChildren && Boolean(this.activePath?.startsWith(prefix)));
    for (let index = this.tabs.length - 1; index >= 0; index -= 1) {
      const tabPath = this.tabs[index].path;
      if (
        tabPath === normalized ||
        (includeChildren && tabPath.startsWith(prefix))
      )
        this.tabs.splice(index, 1);
    }
    if (!removedActive) return { removedActive };
    const next = this.tabs.at(-1);
    this.activePath = undefined;
    return { removedActive, next };
  }

  persistedTabs(): readonly PersistedEditor[] {
    return this.tabs.flatMap((tab) =>
      tab.mode === "settings"
        ? []
        : [{ path: tab.path, mode: tab.mode, scrollTop: tab.scrollTop }],
    );
  }

  restore(
    tabs: readonly PersistedEditor[],
    activePath?: string,
  ): readonly EditorTab[] {
    this.tabs.splice(0, this.tabs.length);
    for (const saved of tabs) {
      if (this.find(saved.path)) continue;
      const tab = this.add(saved.path, saved.mode, "loading");
      tab.scrollTop = saved.scrollTop;
    }
    const restoredActive = activePath ? this.find(activePath) : undefined;
    this.activePath = restoredActive?.path ?? this.tabs.at(-1)?.path;
    return this.tabs;
  }

  diagnostics(path: string): readonly SyntaxDiagnostic[] {
    return this.syntaxDiagnostics.get(editorPath(path)) ?? [];
  }

  setDiagnostics(
    path: string,
    diagnostics: readonly SyntaxDiagnostic[],
  ): boolean {
    const normalized = editorPath(path);
    const hadErrors = this.syntaxDiagnostics.has(normalized);
    if (diagnostics.length) this.syntaxDiagnostics.set(normalized, diagnostics);
    else this.syntaxDiagnostics.delete(normalized);
    return hadErrors !== diagnostics.length > 0;
  }

  reset(): void {
    this.tabs.splice(0, this.tabs.length);
    this.syntaxDiagnostics.clear();
    this.activePath = undefined;
  }
}
