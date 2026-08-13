import type { GatewayCommandResult, Workspace } from "./contracts";

const commandTimeoutMilliseconds = 30_000;
const workspaceTimeoutMilliseconds = 20_000;

export interface GatewayCredentials {
  readonly gatewayUrl: string;
  readonly token: string;
}

export function nextRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function gatewayPath(url: string, path: string): string {
  return `${url.replace(/\/$/, "")}${path}`;
}

export function gatewayEventUrl(url: string): string {
  return gatewayPath(url.replace(/^http/i, "ws"), "/v1/events");
}

export async function gatewayCommand(
  credentials: GatewayCredentials,
  body: Record<string, unknown>,
  version = 1,
): Promise<GatewayCommandResult> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    commandTimeoutMilliseconds,
  );
  try {
    const response = await fetch(
      gatewayPath(credentials.gatewayUrl, "/v1/commands"),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${credentials.token}`,
        },
        body: JSON.stringify({ version, requestId: nextRequestId(), ...body }),
        signal: controller.signal,
      },
    );
    const result = (await response.json()) as GatewayCommandResult;
    if (!response.ok || result.type === "rejected")
      throw new Error(result.message ?? "Gateway rejected the request.");
    return result;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError")
      throw new Error("The gateway did not respond within 30 seconds.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function gatewayWorkspaces(
  credentials: GatewayCredentials,
): Promise<readonly Workspace[]> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    workspaceTimeoutMilliseconds,
  );
  let response: Response;
  try {
    response = await fetch(
      gatewayPath(credentials.gatewayUrl, "/v1/workspaces"),
      {
        headers: { authorization: `Bearer ${credentials.token}` },
        signal: controller.signal,
      },
    );
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError")
      throw new Error(
        "The Truss gateway did not respond within 20 seconds. Keep the Truss Desktop or VS Code pairing window open while connecting.",
      );
    throw new Error(
      "Could not reach a Truss gateway at this address. LM Studio is the model server and cannot be entered here directly.",
    );
  } finally {
    clearTimeout(timeout);
  }
  let result: {
    readonly workspaces?: readonly Workspace[];
    readonly error?: string;
  };
  try {
    result = (await response.json()) as {
      readonly workspaces?: readonly Workspace[];
      readonly error?: string;
    };
  } catch {
    throw new Error(
      "This address is not a Truss gateway. Scan the QR code from Truss Desktop or VS Code instead of entering the LM Studio URL.",
    );
  }
  if (!response.ok || !result.workspaces?.length) {
    if (response.status === 401)
      throw new Error(
        "The gateway rejected this pairing token. Create and scan a new QR code.",
      );
    throw new Error(
      result.error ?? "This address is not an active Truss gateway.",
    );
  }
  return result.workspaces;
}
