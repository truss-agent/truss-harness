import type { ControlBridge } from "./shared.js";

declare global {
  interface Window {
    trussControlCenter: ControlBridge;
  }
}
