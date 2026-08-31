import {
  balancedSidebarTracks,
  clamp,
  collapsedSidebarTracks,
  expandedSidebarTracks,
  resizeSidebarTracks,
} from "./panes.js";

export type CenterView = "editor" | "preview" | "agents" | "chat";

export interface LayoutElements {
  readonly document: Document;
  readonly workbench: HTMLElement;
  readonly sidebar: HTMLElement;
  readonly editorArea: HTMLElement;
  readonly centerSurface: HTMLElement;
  readonly editor: HTMLElement;
  readonly browserPanel: HTMLElement;
  readonly agentsPanel: HTMLElement;
  readonly chatArea: HTMLElement;
  readonly chatSplitter: HTMLElement;
  readonly toggleChat: HTMLButtonElement;
  readonly showChatPanel: HTMLButtonElement;
  readonly toggleChatDock: HTMLButtonElement;
  readonly gitPanel: HTMLElement;
  readonly gitBody: HTMLElement;
  readonly filesSection: HTMLElement;
  readonly terminal: HTMLElement;
  readonly sidebarSplitter: HTMLElement;
  readonly gitSplitter: HTMLElement;
  readonly terminalSplitter: HTMLElement;
}

export interface LayoutCallbacks {
  readonly renderAgents: () => void;
  readonly renderGit: () => void;
}

/** Owns workbench view, docking, collapse, and pointer/keyboard pane resizing. */
export class DesktopLayoutController {
  private viewValue: CenterView = "editor";
  private chatCollapsedValue = false;
  private chatDockedValue = false;
  private gitCollapsedValue = false;
  private gitPanelHeight = 220;
  private observedSidebarHeight = 0;
  private readonly resizeObserver: ResizeObserver;

  constructor(
    private readonly elements: LayoutElements,
    private readonly callbacks: LayoutCallbacks,
  ) {
    this.resizeObserver = new ResizeObserver(() => this.resizeSidebar());
  }

  get view(): CenterView {
    return this.viewValue;
  }

  get chatCollapsed(): boolean {
    return this.chatCollapsedValue;
  }

  get chatDocked(): boolean {
    return this.chatDockedValue;
  }

  get gitCollapsed(): boolean {
    return this.gitCollapsedValue;
  }

  bind(): void {
    this.bindPaneResize(this.elements.sidebarSplitter, "x", () => {
      const initial = this.elements.sidebar.getBoundingClientRect().width;
      return (delta) =>
        this.elements.workbench.style.setProperty(
          "--sidebar-width",
          `${clamp(initial + delta, 190, 520)}px`,
        );
    });
    this.bindPaneResize(this.elements.chatSplitter, "x", () => {
      const initial = this.elements.chatArea.getBoundingClientRect().width;
      return (delta) =>
        this.elements.workbench.style.setProperty(
          "--chat-width",
          `${clamp(initial - delta, 330, 680)}px`,
        );
    });
    this.bindPaneResize(this.elements.gitSplitter, "y", () => {
      if (this.gitCollapsedValue) this.setGitCollapsed(false);
      const initial = this.sidebarTracks();
      return (delta) => {
        const applied = clamp(delta, 110 - initial.files, initial.git - 160);
        this.gitPanelHeight = initial.git - applied;
        this.applySidebarTracks(this.gitPanelHeight, initial.files + applied);
      };
    });
    this.bindPaneResize(this.elements.terminalSplitter, "y", () => {
      const initial = this.elements.terminal.getBoundingClientRect().height;
      const adjacent =
        this.elements.centerSurface.getBoundingClientRect().height;
      return (delta) => {
        const applied = clamp(delta, 160 - adjacent, initial - 120);
        this.elements.editorArea.style.setProperty(
          "--terminal-height",
          `${initial - applied}px`,
        );
      };
    });
    this.elements.gitSplitter.ondblclick = () => this.resetSidebarTracks();
    this.resizeObserver.observe(this.elements.sidebar);
  }

  dispose(): void {
    this.resizeObserver.disconnect();
  }

  setCenterView(next: CenterView): void {
    if (next === "chat" && !this.chatDockedValue) {
      this.setChatDocked(true);
      return;
    }
    this.viewValue = next;
    this.elements.editor.hidden = next !== "editor";
    this.elements.browserPanel.hidden = next !== "preview";
    this.elements.agentsPanel.hidden = next !== "agents";
    this.elements.chatArea.hidden = this.chatDockedValue && next !== "chat";
    this.elements.document
      .querySelectorAll<HTMLButtonElement>("[data-center-view]")
      .forEach((button) => {
        button.classList.toggle("active", button.dataset.centerView === next);
      });
    if (next === "agents") this.callbacks.renderAgents();
  }

  setChatCollapsed(next: boolean): void {
    this.chatCollapsedValue = next;
    this.elements.chatArea.classList.toggle("chat-collapsed", next);
    this.elements.workbench.classList.toggle(
      "chat-collapsed",
      next && !this.chatDockedValue,
    );
    this.elements.toggleChat.textContent = next ? "Show" : "Hide";
    this.elements.toggleChat.title = next
      ? "Show chat panel"
      : "Hide chat panel";
    this.elements.toggleChat.setAttribute("aria-expanded", String(!next));
    this.elements.toggleChatDock.hidden = next;
    this.elements.showChatPanel.hidden = !next;
    if (next && this.chatDockedValue) this.setCenterView("editor");
  }

  setChatDocked(next: boolean): void {
    if (this.chatDockedValue === next) {
      if (next) this.setCenterView("chat");
      return;
    }
    this.chatDockedValue = next;
    this.setChatCollapsed(false);
    if (next) {
      this.elements.centerSurface.append(this.elements.chatArea);
      this.elements.chatSplitter.hidden = true;
      this.elements.chatArea.classList.add("chat-docked");
      this.elements.toggleChatDock.textContent = "Side panel";
      this.elements.toggleChatDock.title = "Return chat panel to the side";
      this.elements.toggleChatDock.setAttribute("aria-pressed", "true");
      this.elements.workbench.classList.add("chat-docked");
      this.setCenterView("chat");
      return;
    }
    this.elements.chatSplitter.after(this.elements.chatArea);
    this.elements.chatSplitter.hidden = false;
    this.elements.chatArea.classList.remove("chat-docked");
    this.elements.toggleChatDock.textContent = "Full size";
    this.elements.toggleChatDock.title = "Move chat panel into the editor area";
    this.elements.toggleChatDock.setAttribute("aria-pressed", "false");
    this.elements.workbench.classList.remove("chat-docked");
    this.setCenterView("editor");
  }

  setGitCollapsed(collapsed: boolean): void {
    if (this.gitCollapsedValue === collapsed) return;
    const tracks = this.sidebarTracks();
    if (collapsed) this.gitPanelHeight = tracks.git;
    this.gitCollapsedValue = collapsed;
    this.callbacks.renderGit();
    const next = collapsed
      ? collapsedSidebarTracks(tracks)
      : expandedSidebarTracks(tracks, this.gitPanelHeight);
    this.applySidebarTracks(next.git, next.files);
  }

  resetSidebarTracks(): void {
    const splitterHeight = this.elements.gitSplitter.getBoundingClientRect().height;
    const tracks = balancedSidebarTracks(
      this.elements.sidebar.getBoundingClientRect().height,
      splitterHeight,
      this.gitCollapsedValue,
    );
    if (!this.gitCollapsedValue) this.gitPanelHeight = tracks.git;
    this.applySidebarTracks(tracks.git, tracks.files);
  }

  private sidebarTracks(): {
    readonly git: number;
    readonly files: number;
  } {
    return {
      git: this.elements.gitPanel.getBoundingClientRect().height,
      files: this.elements.filesSection.getBoundingClientRect().height,
    };
  }

  private applySidebarTracks(
    git: number,
    files: number,
  ): void {
    this.elements.sidebar.style.setProperty("--git-height", `${git}px`);
    this.elements.sidebar.style.setProperty("--files-height", `${files}px`);
  }

  private resizeSidebar(): void {
    const sidebarHeight = Math.floor(
      this.elements.sidebar.getBoundingClientRect().height,
    );
    if (!sidebarHeight || sidebarHeight === this.observedSidebarHeight) return;
    this.observedSidebarHeight = sidebarHeight;
    const splitterHeight = this.elements.gitSplitter.getBoundingClientRect().height;
    const tracks = resizeSidebarTracks(
      this.sidebarTracks(),
      sidebarHeight,
      splitterHeight,
      this.gitCollapsedValue,
    );
    this.applySidebarTracks(tracks.git, tracks.files);
  }

  private bindPaneResize(
    splitter: HTMLElement,
    axis: "x" | "y",
    createMove: () => (delta: number) => void,
  ): void {
    splitter.tabIndex = 0;
    splitter.setAttribute(
      "aria-orientation",
      axis === "x" ? "vertical" : "horizontal",
    );
    splitter.addEventListener("pointerdown", (down) => {
      down.preventDefault();
      const start = axis === "x" ? down.clientX : down.clientY;
      const move = createMove();
      this.elements.document.body.classList.add("resizing");
      splitter.setPointerCapture(down.pointerId);
      const onMove = (event: PointerEvent): void =>
        move((axis === "x" ? event.clientX : event.clientY) - start);
      const onEnd = (): void => {
        this.elements.document.body.classList.remove("resizing");
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onEnd);
        window.removeEventListener("pointercancel", onEnd);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onEnd);
      window.addEventListener("pointercancel", onEnd);
    });
    splitter.addEventListener("keydown", (event) => {
      const increase =
        axis === "x" ? event.key === "ArrowRight" : event.key === "ArrowDown";
      const decrease =
        axis === "x" ? event.key === "ArrowLeft" : event.key === "ArrowUp";
      if (!increase && !decrease) return;
      event.preventDefault();
      createMove()(
        increase ? (event.shiftKey ? 48 : 12) : event.shiftKey ? -48 : -12,
      );
    });
  }
}
