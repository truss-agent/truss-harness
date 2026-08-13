import { join } from "node:path";
import { BrowserWindow, shell, webContents } from "electron";

export class DesktopWindowService {
  private window: BrowserWindow | undefined;

  constructor(
    private readonly distDirectory: () => string,
    private readonly title: string,
    private readonly zoomFactor: () => number,
    private readonly onClosed: () => void,
  ) {}

  get current(): BrowserWindow | undefined {
    return this.window;
  }

  async create(): Promise<BrowserWindow> {
    const window = new BrowserWindow({
      width: 1440,
      height: 940,
      minWidth: 960,
      minHeight: 640,
      title: this.title,
      icon: join(this.distDirectory(), "assets", "brand-logo.png"),
      autoHideMenuBar: true,
      backgroundColor: "#11161a",
      webPreferences: {
        preload: join(this.distDirectory(), "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        webviewTag: true,
      },
    });
    this.window = window;
    window.center();
    window.webContents.setZoomFactor(this.zoomFactor());
    window.webContents.on(
      "will-attach-webview",
      (event, webPreferences, params) => {
        if (!isAllowedPreviewUrl(params.src)) {
          event.preventDefault();
          return;
        }
        delete webPreferences.preload;
        webPreferences.nodeIntegration = false;
        webPreferences.contextIsolation = true;
        webPreferences.sandbox = true;
      },
    );
    window.webContents.on("did-attach-webview", (_event, contents) => {
      contents.setWindowOpenHandler(({ url }) => {
        if (isAllowedPreviewUrl(url) && url !== "about:blank")
          void shell.openExternal(url);
        return { action: "deny" };
      });
      contents.on("will-navigate", (event, url) => {
        if (!isAllowedPreviewUrl(url)) event.preventDefault();
      });
      contents.on("before-input-event", (event, input) => {
        if (input.key !== "F12") return;
        event.preventDefault();
        contents.openDevTools({ mode: "detach" });
      });
    });
    await window.loadFile(join(this.distDirectory(), "index.html"));
    window.on("closed", () => {
      if (this.window === window) this.window = undefined;
      this.onClosed();
    });
    return window;
  }

  setZoomFactor(zoomFactor: number): void {
    this.window?.webContents.setZoomFactor(zoomFactor);
  }

  send(channel: string, value: unknown): void {
    this.window?.webContents.send(channel, value);
  }

  focus(): void {
    this.window?.center();
    this.window?.focus();
  }

  closeWebviews(): void {
    for (const contents of webContents.getAllWebContents())
      if (contents.getType() === "webview") contents.close();
  }
}

export function validatedPreviewUrl(value: string): string {
  const normalized = /^[a-z][a-z\d+.-]*:\/\//i.test(value.trim())
    ? value.trim()
    : `http://${value.trim()}`;
  const url = new URL(normalized);
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("Preview URLs must use HTTP or HTTPS.");
  return url.toString();
}

export function isAllowedPreviewUrl(value: string): boolean {
  if (value === "about:blank") return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
