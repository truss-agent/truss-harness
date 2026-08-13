import { afterEach, describe, expect, it, vi } from "vitest";
import {
  gatewayCommand,
  gatewayEventUrl,
  gatewayPath,
  gatewayWorkspaces,
} from "./gateway-transport.js";

const credentials = {
  gatewayUrl: "http://192.168.1.20:4787/",
  token: "trusted-token",
};

afterEach(() => vi.unstubAllGlobals());

describe("mobile gateway transport", () => {
  it("normalizes command and event endpoint paths", () => {
    expect(gatewayPath(credentials.gatewayUrl, "/v1/commands")).toBe(
      "http://192.168.1.20:4787/v1/commands",
    );
    expect(gatewayEventUrl(credentials.gatewayUrl)).toBe(
      "ws://192.168.1.20:4787/v1/events",
    );
  });

  it("sends authenticated versioned commands and returns their result", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ type: "session_created", sessionId: "s1" }),
          {
            status: 200,
          },
        ),
    );
    vi.stubGlobal("fetch", fetch);

    await expect(
      gatewayCommand(
        credentials,
        { type: "create_session", workspaceId: "w1" },
        2,
      ),
    ).resolves.toMatchObject({ type: "session_created", sessionId: "s1" });
    expect(fetch).toHaveBeenCalledWith(
      "http://192.168.1.20:4787/v1/commands",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer trusted-token",
        }),
      }),
    );
  });

  it("maps rejected gateway responses and valid workspace discovery", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ type: "rejected", message: "Denied" }), {
          status: 403,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            workspaces: [
              {
                id: "w1",
                displayName: "Workspace",
                capabilities: { modes: ["chat"] },
              },
            ],
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetch);

    await expect(
      gatewayCommand(credentials, { type: "send_message" }),
    ).rejects.toThrow("Denied");
    await expect(gatewayWorkspaces(credentials)).resolves.toMatchObject([
      { id: "w1", displayName: "Workspace" },
    ]);
  });
});
