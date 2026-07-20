import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";

export interface LanAddressSource { networkInterfaces(): NodeJS.Dict<NetworkInterfaceInfo[]>; }

const privateIpv4 = /^(10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/;

/** Finds a reachable private IPv4 address for a same-Wi-Fi mobile connection. */
export function detectLanAddress(source: LanAddressSource = { networkInterfaces }): string | undefined {
  for (const addresses of Object.values(source.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal && privateIpv4.test(address.address)) return address.address;
    }
  }
  return undefined;
}

export function createPairingUri(input: { readonly gatewayUrl: string; readonly token: string; readonly workspaceName: string }): string {
  const url = new URL("truss://pair");
  url.searchParams.set("gateway", input.gatewayUrl);
  url.searchParams.set("token", input.token);
  url.searchParams.set("name", input.workspaceName);
  return url.toString();
}
