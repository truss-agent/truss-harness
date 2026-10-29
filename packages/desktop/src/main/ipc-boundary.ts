import type { IpcMain, WebContents } from "electron";
import { validDesktopIpcInput } from "./ipc-input.js";

/** All native entrypoints share the same identity and input boundary. */
export function guardedDesktopIpc(
  ipc: Pick<IpcMain, "handle">,
  primary: () =>
    | { readonly contents: WebContents; readonly url: string }
    | undefined,
): Pick<IpcMain, "handle"> {
  return {
    handle(channel, listener) {
      if (!validDesktopIpcInput(channel))
        throw new Error(`Unknown desktop IPC channel: ${channel}`);
      ipc.handle(channel, (event, ...args: unknown[]) => {
        const expected = primary();
        if (
          !expected ||
          event.sender !== expected.contents ||
          !event.senderFrame ||
          event.senderFrame !== expected.contents.mainFrame ||
          event.senderFrame.url.split("#")[0] !== expected.url
        )
          throw new Error("Unauthorized desktop IPC sender.");
        if (!validDesktopIpcInput(channel, args))
          throw new Error(`Invalid input for ${channel}.`);
        return listener(event, ...args);
      });
    },
  };
}
