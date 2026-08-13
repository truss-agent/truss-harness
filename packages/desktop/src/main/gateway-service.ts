import { randomBytes } from "node:crypto";
import { basename } from "node:path";
import {
  createGatewayAgentController,
  createPairingUri,
  detectLanAddress,
  type RunningRemoteGateway,
  startRemoteGateway,
} from "@truss-harness/gateway";
import type { AgentCoordinator } from "@truss-harness/runtime";
import QRCode from "qrcode";
import type { DesktopState } from "../shared.js";
import type { DesktopRuntimeService } from "./runtime-service.js";

const desktopGatewayPort = 4787;

interface TrussGoGatewayPlatform {
  readonly detectAddress: () => string | undefined;
  readonly createToken: () => string;
  readonly startGateway: typeof startRemoteGateway;
  readonly createPairingUri: typeof createPairingUri;
  readonly createQrDataUrl: (value: string) => Promise<string>;
}

const defaultPlatform: TrussGoGatewayPlatform = {
  detectAddress: detectLanAddress,
  createToken: () => randomBytes(32).toString("hex"),
  startGateway: startRemoteGateway,
  createPairingUri,
  createQrDataUrl: (value) =>
    QRCode.toDataURL(value, { margin: 2, width: 320 }),
};

export class TrussGoGatewayService {
  private gateway: RunningRemoteGateway | undefined;

  constructor(
    private readonly state: () => DesktopState,
    private readonly coordinator: () => AgentCoordinator | undefined,
    private readonly runtime: DesktopRuntimeService,
    private readonly platform: TrussGoGatewayPlatform = defaultPlatform,
  ) {}

  async stop(): Promise<void> {
    await this.gateway?.close();
    this.gateway = undefined;
    await this.runtime.disposeRemoteClients();
  }

  async connect(): Promise<{
    readonly workspaceName: string;
    readonly qrDataUrl: string;
  }> {
    const state = this.state();
    const configuration = state.configuration;
    if (!configuration?.model)
      throw new Error("Choose a local model before connecting Truss Go.");
    const address = this.platform.detectAddress();
    if (!address)
      throw new Error(
        "Could not find a private Wi-Fi address for this computer.",
      );
    await this.stop();
    const token = this.platform.createToken();
    const configuredMcpServers = Object.entries(configuration.mcpServers ?? {});
    const coordinator = this.coordinator();
    try {
      this.gateway = await this.platform.startGateway({
        token,
        host: address,
        port: desktopGatewayPort,
        workspaces: [
          {
            id: "active-workspace",
            displayName: basename(state.workspaceRoot),
            ...(coordinator
              ? {
                  agents: createGatewayAgentController(coordinator, {
                    allowStart: true,
                  }),
                }
              : {}),
            ...(configuredMcpServers.length
              ? {
                  mcp: {
                    list: () =>
                      configuredMcpServers.map(([name, server]) => {
                        const live = this.runtime.mcpServers.find(
                          (status) => status.name === name,
                        );
                        return (
                          live ?? {
                            name,
                            state:
                              server.enabled === false ? "disabled" : "idle",
                            toolCount: 0,
                          }
                        );
                      }),
                  },
                }
              : {}),
            createRuntime: (mode, toolApprovalMode) =>
              this.runtime.createRemoteRuntime(
                configuration,
                mode,
                toolApprovalMode,
              ),
          },
        ],
      });
    } catch (error) {
      if (isAddressInUse(error))
        throw new Error(
          `Truss Go port ${desktopGatewayPort} is already in use. Disconnect Truss Go in another Truss client and try again.`,
        );
      throw error;
    }
    const workspaceName = basename(state.workspaceRoot);
    const pairingUri = this.platform.createPairingUri({
      gatewayUrl: this.gateway.url,
      token,
      workspaceName,
    });
    return {
      workspaceName,
      qrDataUrl: await this.platform.createQrDataUrl(pairingUri),
    };
  }
}

function isAddressInUse(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as Error & { readonly code?: string }).code === "EADDRINUSE"
  );
}
