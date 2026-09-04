import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ControlCenterService } from "./control-center-service.js";

describe("ControlCenterService", () => {
  it("keeps independent agent profiles attached to their selected repositories", async () => {
    const root = await mkdtemp(join(tmpdir(), "truss-control-center-"));
    try {
      const service = new ControlCenterService(join(root, "state.json"));
      await service.load();
      await service.addWorkspace(join(root, "api"));
      await service.addWorkspace(join(root, "web"));
      const workspaces = (await service.snapshot()).workspaces;
      const [api, web] = workspaces;
      if (!api || !web) throw new Error("Expected two workspaces.");
      await service.createAgent({
        workspaceId: api.id,
        displayName: "API agent",
        mode: "edit",
        approvalPolicy: "ask",
        internetAccess: false,
        provider: {
          providerId: "ollama",
          endpointUrl: "http://127.0.0.1:11434",
          modelId: "example",
        },
      });
      await service.createAgent({
        workspaceId: web.id,
        displayName: "Web planner",
        mode: "plan",
        approvalPolicy: "auto-read",
        internetAccess: false,
        provider: {
          providerId: "ollama",
          endpointUrl: "http://127.0.0.1:11434",
          modelId: "example",
        },
      });
      expect(await service.snapshot()).toMatchObject({
        workspaces: [{ id: api.id }, { id: web.id }],
        agents: [
          { displayName: "API agent", workspaceId: api.id },
          { displayName: "Web planner", workspaceId: web.id },
        ],
      });
      await service.dispose();
      const reloaded = new ControlCenterService(join(root, "state.json"));
      await reloaded.load();
      expect((await reloaded.snapshot()).agents).toHaveLength(2);
      await reloaded.removeWorkspace(api.id);
      expect(await reloaded.snapshot()).toMatchObject({
        workspaces: [{ id: web.id }],
        agents: [{ workspaceId: web.id }],
      });
      await reloaded.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
