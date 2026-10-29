import { createDefaultSkills } from "@truss-harness/agent-host";
import type {
  RunningRemoteGateway,
  startRemoteGateway,
} from "@truss-harness/gateway";
import { describe, expect, it, vi } from "vitest";
import type { DesktopState } from "../shared.js";
import { TrussGoGatewayService } from "./gateway-service.js";

const state: DesktopState = {
  workspaceRoot: "/workspace/demo",
  zoomFactor: 1,
  updates: { checkOnLaunch: true, autoDownload: false },
  theme: { name: "default" },
  conversations: [],
  configuration: {
    provider: "ollama",
    baseUrl: "http://127.0.0.1:11434",
    model: "qwen3",
    contextWindow: 8192,
    mode: "chat",
    permission: "ask",
    internetAccess: false,
    mcpServers: {},
  },
};

describe("TrussGoGatewayService", () => {
  it("uses the stable mobile gateway port and disposes remote clients", async () => {
    const close = vi.fn(async () => undefined);
    const disposeRemoteClients = vi.fn(async () => undefined);
    const startGateway = vi.fn(
      async (): Promise<RunningRemoteGateway> => ({
        url: "http://192.168.1.20:4787",
        close,
      }),
    );
    const service = new TrussGoGatewayService(
      () => state,
      () => undefined,
      {
        mcpServers: [],
        createRemoteRuntime: vi.fn(),
        disposeRemoteClients,
      } as never,
      {
        detectAddress: () => "192.168.1.20",
        createToken: () => "a".repeat(64),
        startGateway,
        createPairingUri: ({ gatewayUrl }) => `paired:${gatewayUrl}`,
        createQrDataUrl: async (value) => `qr:${value}`,
      },
    );

    await expect(service.connect()).resolves.toEqual({
      workspaceName: "demo",
      qrDataUrl: "qr:paired:http://192.168.1.20:4787",
    });
    expect(startGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "192.168.1.20",
        port: 4787,
      }),
    );

    await service.stop();
    expect(close).toHaveBeenCalledOnce();
    expect(disposeRemoteClients).toHaveBeenCalledTimes(2);
  });

  it("offers skill listing and settings to paired phones, not imports", async () => {
    const startGateway = vi.fn(
      async (): Promise<RunningRemoteGateway> => ({
        url: "http://192.168.1.20:4787",
        close: async () => undefined,
      }),
    );
    const service = new TrussGoGatewayService(
      () => state,
      () => undefined,
      {
        mcpServers: [],
        createRemoteRuntime: vi.fn(),
        disposeRemoteClients: vi.fn(async () => undefined),
      } as never,
      {
        detectAddress: () => "192.168.1.20",
        createToken: () => "a".repeat(64),
        startGateway,
        createPairingUri: ({ gatewayUrl }) => gatewayUrl,
        createQrDataUrl: async (value) => value,
      },
      async () =>
        createDefaultSkills({
          workspaceRoot: state.workspaceRoot,
          userConfigDirectory: "/unused",
        }),
    );
    await service.connect();
    const [options] = startGateway.mock.calls[0] as unknown as [
      Parameters<typeof startRemoteGateway>[0],
    ];
    const skills = options.workspaces[0]?.skills;
    expect(typeof skills?.list).toBe("function");
    expect(typeof skills?.setSettings).toBe("function");
    expect(Object.keys(skills ?? {}).sort()).toEqual(["list", "setSettings"]);
  });

  it("explains a stable-port conflict", async () => {
    const error = Object.assign(new Error("listen failed"), {
      code: "EADDRINUSE",
    });
    const service = new TrussGoGatewayService(
      () => state,
      () => undefined,
      {
        mcpServers: [],
        createRemoteRuntime: vi.fn(),
        disposeRemoteClients: vi.fn(async () => undefined),
      } as never,
      {
        detectAddress: () => "192.168.1.20",
        createToken: () => "a".repeat(64),
        startGateway: vi.fn(async () => {
          throw error;
        }),
        createPairingUri: () => "unused",
        createQrDataUrl: async () => "unused",
      },
    );

    await expect(service.connect()).rejects.toThrow(
      "Truss Go port 4787 is already in use",
    );
  });
});
