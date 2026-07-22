import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";

export interface LanAddressSource { networkInterfaces(): NodeJS.Dict<NetworkInterfaceInfo[]>; }

const privateIpv4 = /^(10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/;
const wirelessInterface = /(?:^|[\s_-])(?:wi-?fi|wlan|wireless)(?:$|[\s\d_-])/i;
const wiredInterface = /(?:^|[\s_-])(?:ethernet|eth|enp|eno|ens)(?:$|[\s\d_-])/i;
const virtualInterface = /wsl|hyper-v|vethernet|vmware|virtualbox|vbox|docker|podman|vpn|tailscale|zerotier|bluetooth|loopback|host-only|container/i;

function interfaceScore(name: string): number {
  if (virtualInterface.test(name)) return -100;
  if (wirelessInterface.test(name)) return 100;
  if (wiredInterface.test(name)) return 50;
  return 0;
}

/** Finds a reachable private IPv4 address for a same-Wi-Fi mobile connection. */
export function detectLanAddress(source: LanAddressSource = { networkInterfaces }): string | undefined {
  const candidates: Array<{ readonly address: string; readonly score: number; readonly order: number }> = [];
  let order = 0;
  for (const [name, addresses] of Object.entries(source.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal && privateIpv4.test(address.address)) {
        candidates.push({ address: address.address, score: interfaceScore(name), order: order++ });
      }
    }
  }
  candidates.sort((left, right) => right.score - left.score || left.order - right.order);
  return candidates[0]?.address;
}

export function createPairingUri(input: { readonly gatewayUrl: string; readonly token: string; readonly workspaceName: string }): string {
  const url = new URL("truss://pair");
  url.searchParams.set("gateway", input.gatewayUrl);
  url.searchParams.set("token", input.token);
  url.searchParams.set("name", input.workspaceName);
  return url.toString();
}
