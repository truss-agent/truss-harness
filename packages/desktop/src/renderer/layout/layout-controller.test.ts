import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DesktopLayoutController,
  type LayoutElements,
} from "./layout-controller.js";

interface FakeElement {
  hidden: boolean;
  textContent: string;
  title: string;
  tabIndex: number;
  readonly attributes: Map<string, string>;
  readonly classes: Set<string>;
  readonly properties: Map<string, string>;
  append(child: unknown): void;
  after(child: unknown): void;
  getBoundingClientRect(): DOMRect;
}

function fakeElement(width = 400, height = 240): FakeElement & HTMLElement {
  const attributes = new Map<string, string>();
  const classes = new Set<string>();
  const properties = new Map<string, string>();
  return {
    hidden: false,
    textContent: "",
    title: "",
    tabIndex: -1,
    attributes,
    classes,
    properties,
    dataset: {},
    classList: {
      add: (...names: string[]) =>
        names.forEach((name) => {
          classes.add(name);
        }),
      remove: (...names: string[]) =>
        names.forEach((name) => {
          classes.delete(name);
        }),
      toggle: (name: string, force?: boolean) => {
        const enabled = force ?? !classes.has(name);
        if (enabled) classes.add(name);
        else classes.delete(name);
        return enabled;
      },
      contains: (name: string) => classes.has(name),
    },
    style: {
      setProperty: (name: string, value: string) =>
        void properties.set(name, value),
      getPropertyValue: (name: string) => properties.get(name) ?? "",
    },
    setAttribute: (name: string, value: string) =>
      void attributes.set(name, value),
    addEventListener: () => undefined,
    setPointerCapture: () => undefined,
    append: () => undefined,
    after: () => undefined,
    getBoundingClientRect: () =>
      ({
        width,
        height,
        x: 0,
        y: 0,
        top: 0,
        right: width,
        bottom: height,
        left: 0,
        toJSON: () => ({}),
      }) as DOMRect,
  } as unknown as FakeElement & HTMLElement;
}

function elements(): LayoutElements {
  const centerButtons = [
    fakeElement(),
    fakeElement(),
  ] as unknown as HTMLButtonElement[];
  centerButtons[0].dataset.centerView = "editor";
  centerButtons[1].dataset.centerView = "agents";
  const body = fakeElement();
  const document = {
    body,
    querySelectorAll: () => centerButtons,
  } as unknown as Document;
  return {
    document,
    workbench: fakeElement(),
    sidebar: fakeElement(300, 720),
    editorArea: fakeElement(),
    centerSurface: fakeElement(800, 520),
    editor: fakeElement(),
    browserPanel: fakeElement(),
    agentsPanel: fakeElement(),
    chatArea: fakeElement(390, 520),
    chatSplitter: fakeElement(6, 520),
    toggleChat: fakeElement() as unknown as HTMLButtonElement,
    showChatPanel: fakeElement() as unknown as HTMLButtonElement,
    toggleChatDock: fakeElement() as unknown as HTMLButtonElement,
    gitPanel: fakeElement(300, 220),
    gitBody: fakeElement(),
    filesSection: fakeElement(300, 220),
    historySection: fakeElement(300, 220),
    terminal: fakeElement(800, 200),
    sidebarSplitter: fakeElement(6, 720),
    gitSplitter: fakeElement(300, 12),
    historySplitter: fakeElement(300, 12),
    terminalSplitter: fakeElement(800, 6),
  };
}

describe("DesktopLayoutController", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(): void {}
        disconnect(): void {}
      },
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("switches center surfaces and renders the Agents view", () => {
    const owned = elements();
    let agentRenders = 0;
    const controller = new DesktopLayoutController(owned, {
      renderAgents: () => agentRenders++,
      renderGit: () => undefined,
    });

    controller.setCenterView("agents");

    expect(controller.view).toBe("agents");
    expect(owned.editor.hidden).toBe(true);
    expect(owned.agentsPanel.hidden).toBe(false);
    expect(agentRenders).toBe(1);
  });

  it("docks Chat before selecting it and restores the editor when undocked", () => {
    const owned = elements();
    const controller = new DesktopLayoutController(owned, {
      renderAgents: () => undefined,
      renderGit: () => undefined,
    });

    controller.setCenterView("chat");
    expect(controller.chatDocked).toBe(true);
    expect(controller.view).toBe("chat");
    expect(owned.workbench.classList.contains("chat-docked")).toBe(true);

    controller.setChatDocked(false);
    expect(controller.chatDocked).toBe(false);
    expect(controller.view).toBe("editor");
  });

  it("keeps Git collapse state inside the controller", () => {
    const owned = elements();
    let gitRenders = 0;
    const controller = new DesktopLayoutController(owned, {
      renderAgents: () => undefined,
      renderGit: () => gitRenders++,
    });

    controller.setGitCollapsed(true);

    expect(controller.gitCollapsed).toBe(true);
    expect(gitRenders).toBe(1);
    expect(owned.sidebar.style.getPropertyValue("--git-height")).toBe("38px");
  });
});
