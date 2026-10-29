import { expect, it, vi } from "vitest";
import type { IpcMain, IpcMainInvokeEvent, WebContents } from "electron";
import { guardedDesktopIpc } from "./ipc-boundary.js";
it("only invokes native operations from the local primary main frame", async () => {
  const handlers = new Map<
    string,
    (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  >();
  const mainFrame = { url: "file:///fixture/index.html" };
  const sender = { mainFrame } as unknown as WebContents;
  const ipc = {
    handle: (
      channel: string,
      handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
    ) => handlers.set(channel, handler),
  } as Pick<IpcMain, "handle">;
  const guarded = guardedDesktopIpc(ipc, () => ({
    contents: sender,
    url: "file:///fixture/index.html",
  }));
  const operation = vi.fn(() => "read");
  guarded.handle("truss:read-file", operation);
  const invoke = (event: unknown, ...args: unknown[]) =>
    handlers.get("truss:read-file")!(event as IpcMainInvokeEvent, ...args);
  expect(invoke({ sender, senderFrame: mainFrame }, "a")).toBe("read");
  for (const event of [
    { sender: {}, senderFrame: mainFrame },
    { sender, senderFrame: { url: mainFrame.url } },
    { sender, senderFrame: null },
  ])
    expect(() => invoke(event, "a")).toThrow(/sender/i);
  mainFrame.url = "https://untrusted.invalid";
  expect(() => invoke({ sender, senderFrame: mainFrame }, "a")).toThrow(
    /sender/i,
  );
  expect(operation).toHaveBeenCalledOnce();
});
it("rejects malformed input and unknown channels before native callbacks", () => {
  const handlers = new Map<
    string,
    (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  >();
  const frame = { url: "file:///fixture/index.html" };
  const contents = { mainFrame: frame } as unknown as WebContents;
  const ipc = {
    handle: (
      channel: string,
      handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
    ) => handlers.set(channel, handler),
  } as Pick<IpcMain, "handle">;
  const guarded = guardedDesktopIpc(ipc, () => ({ contents, url: frame.url }));
  const op = vi.fn();
  const cases: [string, unknown[]][] = [
    ["truss:read-file", [{}]],
    ["truss:git-stage", [["a", 7]]],
    ["truss:resolve-approval", ["call", "yes"]],
    ["truss:send-chat", [{ prompt: "x", conversationId: "c", history: "bad" }]],
    ["truss:complete", [{ prefix: {} }]],
    ["truss:configure-updates", [{ checkOnLaunch: "yes", autoDownload: true }]],
  ];
  for (const [channel, args] of cases) {
    guarded.handle(channel, op);
    expect(() =>
      handlers.get(channel)!(
        { sender: contents, senderFrame: frame } as IpcMainInvokeEvent,
        ...args,
      ),
    ).toThrow(/input/i);
  }
  expect(() => guarded.handle("truss:unknown", op)).toThrow();
  expect(op).not.toHaveBeenCalled();
});
it("guards the registered operational and settings handlers before service effects", async () => {
  const { registerOperationalIpc, registerSettingsIpc } = await import(
    "./ipc-registration.js"
  );
  const handlers = new Map<
    string,
    (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  >();
  const frame = { url: "file:///fixture/index.html" };
  const contents = { mainFrame: frame } as unknown as WebContents;
  const ipc = {
    handle: (
      channel: string,
      handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
    ) => handlers.set(channel, handler),
  } as Pick<IpcMain, "handle">;
  const guarded = guardedDesktopIpc(ipc, () => ({ contents, url: frame.url }));
  let reads = 0;
  const deps = {
    ipc: guarded,
    runtime: {},
    agents: {},
    workspace: {
      readFile: (path: string) => {
        reads++;
        return `contents:${path}`;
      },
    },
    git: {},
    terminal: {},
    gateway: {},
    revealPath() {},
    openExternal: async () => {},
    loadPlan: async () => {},
    complete: async () => "",
    formatFile: async () => "",
    checkSyntax: async () => [],
  };
  registerOperationalIpc(
    deps as unknown as import("./ipc-registration.js").OperationalIpcDependencies,
  );
  registerSettingsIpc(
    guarded,
    {} as import("./settings-service.js").DesktopSettingsService,
    () => ({}),
  );
  const handler = handlers.get("truss:read-file")!;
  expect(() =>
    handler(
      { sender: {}, senderFrame: frame } as unknown as IpcMainInvokeEvent,
      "a",
    ),
  ).toThrow();
  expect(reads).toBe(0);
  expect(
    handler(
      { sender: contents, senderFrame: frame } as IpcMainInvokeEvent,
      "a",
    ),
  ).toBe("contents:a");
  expect(reads).toBe(1);
});
