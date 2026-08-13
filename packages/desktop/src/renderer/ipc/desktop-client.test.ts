import { describe, expect, it } from "vitest";
import type { DesktopBridge } from "../../shared.js";
import { desktopClient } from "./desktop-client.js";

describe("desktopClient", () => {
  it("returns the preload-owned typed bridge", () => {
    const bridge = {} as DesktopBridge;
    expect(desktopClient({ trussDesktop: bridge })).toBe(bridge);
  });

  it("fails clearly when preload did not expose the bridge", () => {
    expect(() => desktopClient({})).toThrow("bridge is unavailable");
  });
});
