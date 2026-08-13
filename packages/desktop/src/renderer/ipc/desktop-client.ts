import type { DesktopBridge } from "../../shared.js";

export interface DesktopBridgeHost {
  readonly trussDesktop?: DesktopBridge;
}

/** Returns the single typed renderer-to-preload boundary. */
export function desktopClient(host: DesktopBridgeHost): DesktopBridge {
  if (!host.trussDesktop)
    throw new Error("The Truss Desktop bridge is unavailable.");
  return host.trussDesktop;
}
