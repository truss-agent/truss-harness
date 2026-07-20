import { describe, expect, it } from "vitest";
import { createPairingUri, detectLanAddress } from "./pairing.js";

describe("LAN pairing", () => {
  it("selects a private, non-loopback IPv4 address", () => {
    expect(detectLanAddress({ networkInterfaces: () => ({ loopback: [{ address: "127.0.0.1", family: "IPv4", internal: true, netmask: "255.0.0.0", cidr: null, mac: "", scopeid: 0 }, { address: "192.168.40.12", family: "IPv4", internal: false, netmask: "255.255.255.0", cidr: null, mac: "", scopeid: 0 }] }) })).toBe("192.168.40.12");
  });

  it("encodes only the gateway connection and pairing credential", () => {
    const parsed = new URL(createPairingUri({ gatewayUrl: "http://192.168.40.12:4788", token: "a".repeat(32), workspaceName: "demo" }));
    expect(parsed.protocol).toBe("truss:"); expect(parsed.hostname).toBe("pair"); expect(parsed.searchParams.get("gateway")).toBe("http://192.168.40.12:4788"); expect(parsed.searchParams.get("token")).toHaveLength(32);
  });
});
