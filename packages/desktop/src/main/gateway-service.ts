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

export class TrussGoGatewayService {
  private gateway: RunningRemoteGateway | undefined;

  constructor(
    private readonly state: () => DesktopState,
    private readonly coordinator: () => AgentCoordinator | undefined,
    private readonly runtime: DesktopRuntimeService,
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
    const address = detectLanAddress();
    if (!address)
      throw new Error(
        "Could not find a private Wi-Fi address for this computer.",
      );
    await this.stop();
    const token = randomBytes(32).toString("hex");
    const configuredMcpServers = Object.entries(configuration.mcpServers ?? {});
    const coordinator = this.coordinator();
    this.gateway = await startRemoteGateway({
      token,
      host: address,
      port: 0,
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
                          state: server.enabled === false ? "disabled" : "idle",
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
    const workspaceName = basename(state.workspaceRoot);
    const pairingUri = createPairingUri({
      gatewayUrl: this.gateway.url,
      token,
      workspaceName,
    });
    return {
      workspaceName,
      qrDataUrl: await QRCode.toDataURL(pairingUri, { margin: 2, width: 320 }),
    };
  }
}
