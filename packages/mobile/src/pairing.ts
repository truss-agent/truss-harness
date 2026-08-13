import type { ApprovalMode, AgentMode, SavedGateway } from "./contracts";

export const savedGatewaysKey = "truss.remote.saved-gateways.v1";
export const savedPreferencesKey = "truss.remote.preferences.v1";
export const allApprovalModes = ["ask", "auto-read", "auto-all"] as const;

export function parsePairing(value: string): SavedGateway {
  const uri = new URL(value);
  if (uri.protocol !== "truss:" || uri.hostname !== "pair")
    throw new Error("This is not a Truss pairing QR code.");
  const url = uri.searchParams.get("gateway");
  const token = uri.searchParams.get("token");
  if (!url || !token || token.length < 24 || !/^https?:\/\//.test(url))
    throw new Error("The pairing QR code is incomplete.");
  return {
    id: url,
    name: uri.searchParams.get("name") ?? new URL(url).host,
    url,
    token,
  };
}

export function parsePreferences(value: string): {
  readonly mode?: AgentMode;
  readonly approvalMode?: ApprovalMode;
} {
  const parsed = JSON.parse(value) as {
    readonly mode?: unknown;
    readonly approvalMode?: unknown;
  };
  return {
    ...(typeof parsed.mode === "string" &&
    ["chat", "plan", "edit"].includes(parsed.mode)
      ? { mode: parsed.mode as AgentMode }
      : {}),
    ...(typeof parsed.approvalMode === "string" &&
    allApprovalModes.includes(parsed.approvalMode as ApprovalMode)
      ? { approvalMode: parsed.approvalMode as ApprovalMode }
      : {}),
  };
}

export function upsertGateway(
  gateways: readonly SavedGateway[],
  gateway: SavedGateway,
): readonly SavedGateway[] {
  return [gateway, ...gateways.filter((item) => item.id !== gateway.id)];
}
