import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  windows: [] as unknown[],
  external: vi.fn(),
}));
vi.mock("electron", () => ({
  BrowserWindow: class extends EventEmitter {
    readonly webContents = Object.assign(new EventEmitter(), {
      setZoomFactor() {},
      setWindowOpenHandler: vi.fn(),
      session: {
        setPermissionRequestHandler: vi.fn(),
        setPermissionCheckHandler: vi.fn(),
      },
    });
    constructor(readonly options: unknown) {
      super();
      fixture.windows.push(this);
    }
    center() {}
    async loadFile() {}
  },
  session: {
    fromPartition: () => ({
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
    }),
  },
  shell: { openExternal: fixture.external },
  webContents: { getAllWebContents: () => [] },
}));
import { DesktopWindowService } from "./window-service.js";
it("sandboxes the primary window and blocks foreign navigation and popups", async () => {
  const service = new DesktopWindowService(
    () => "/fixture",
    "Fixture",
    () => 1,
    () => {},
  );
  const window = await service.create();
  const fake = window as unknown as {
    options: { webPreferences: { sandbox: boolean } };
    webContents: EventEmitter & {
      setWindowOpenHandler: ReturnType<typeof vi.fn>;
    };
  };
  expect(fake.options.webPreferences.sandbox).toBe(true);
  const preventDefault = vi.fn();
  fake.webContents.emit(
    "will-navigate",
    { preventDefault },
    "https://untrusted.invalid",
  );
  expect(preventDefault).toHaveBeenCalledOnce();
  const open = fake.webContents.setWindowOpenHandler.mock.calls[0]![0];
  expect(open({ url: "https://example.invalid" })).toEqual({ action: "deny" });
  expect(fixture.external).toHaveBeenCalledWith("https://example.invalid");
});
it("retains guest preload stripping and default-denies preview permissions", async () => {
  const service = new DesktopWindowService(
    () => "/fixture",
    "Fixture",
    () => 1,
    () => {},
  );
  const window = await service.create();
  const preferences = {
    preload: "/bad",
    nodeIntegration: true,
    contextIsolation: false,
    sandbox: false,
  };
  const preventDefault = vi.fn();
  window.webContents.emit(
    "will-attach-webview",
    { preventDefault },
    preferences,
    { src: "https://preview.invalid", partition: "truss-preview" },
  );
  expect(preferences).toEqual({
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
  });
  expect(preventDefault).not.toHaveBeenCalled();
  const request = vi.fn();
  const check = vi.fn();
  const guest = Object.assign(new EventEmitter(), {
    session: {
      setPermissionRequestHandler: request,
      setPermissionCheckHandler: check,
    },
    setWindowOpenHandler: vi.fn(),
  });
  window.webContents.emit("did-attach-webview", {}, guest);
  const decide = vi.fn();
  request.mock.calls[0]![0]({}, "media", decide);
  expect(decide).toHaveBeenCalledWith(false);
  expect(check.mock.calls[0]![0]()).toBe(false);
});
