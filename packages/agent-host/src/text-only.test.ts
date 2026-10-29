import { expect, it } from "vitest";
import { AgentHost } from "./host.js";
import { AgentProviderRegistry } from "./providers.js";
import type { AgentProfile, ModelStreamEvent } from "@truss-harness/runtime";
it("enforces an empty tool registry and rejects provider tool calls without approval", async () => {
  let tools: readonly unknown[] | undefined;
  let approvals = 0;
  const registry = new AgentProviderRegistry();
  registry.register({
    descriptor: { id: "fixture", label: "Fixture", requiresCredential: false },
    async validate() {},
    async create() {
      return {
        id: "fixture",
        async *stream(request): AsyncIterable<ModelStreamEvent> {
          tools = request.tools;
          yield {
            type: "tool_call",
            id: "write",
            name: "write_file",
            input: { path: "sentinel", content: "bad" },
          };
        },
      };
    },
  });
  const profile: AgentProfile = {
    id: "helper",
    displayName: "Helper",
    provider: { providerId: "fixture", modelId: "fixture" },
    mode: "edit",
    approvalPolicy: "auto-all",
    internetAccess: true,
    createdAt: "",
    updatedAt: "",
  };
  const host = new AgentHost({
    workspaceRoot: process.cwd(),
    providerRegistry: registry,
    approvalFactory: () => ({
      approve: async () => {
        approvals++;
        return true;
      },
    }),
  });
  const hosted = await host.createRuntime(profile, { textOnly: true });
  const session = await hosted.runtime.createSession();
  await expect(hosted.runtime.run(session.id, "complete")).rejects.toThrow(
    /text.only/i,
  );
  expect(tools).toEqual([]);
  expect(approvals).toBe(0);
  await hosted.dispose();
});
