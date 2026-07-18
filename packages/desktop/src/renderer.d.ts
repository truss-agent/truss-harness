import type { DesktopBridge } from "./shared.js";

declare global {
  interface Window {
    trussDesktop: DesktopBridge;
  }
}

export {};
