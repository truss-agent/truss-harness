import { describe, expect, it } from "vitest";
import {
  AgentProviderRegistry,
  type AgentProviderFactory,
} from "@truss-harness/agent-host";
import type { ModelProvider, ModelStreamEvent } from "@truss-harness/runtime";
import { testClientProviderConnection } from "./runtime.js";

describe("testClientProviderConnection", () => {
  it("uses the host preflight contract without creating a chat runtime", async () => {
    const registry = new AgentProviderRegistry();
    const factory: AgentProviderFactory = {
      descriptor: {
        id: "test-provider",
        label: "Test provider",
        requiresCredential: false,
      },
      async validate() {},
      async create(): Promise<ModelProvider> {
        return {
          id: "test-provider",
          async *stream(): AsyncIterable<ModelStreamEvent> {
            yield { type: "finish", reason: "stop" };
          },
        };
      },
    };
    registry.register(factory);

    await expect(
      testClientProviderConnection({
        workspaceRoot: process.cwd(),
        provider: "test-provider" as never,
        baseUrl: "http://127.0.0.1:8080/v1",
        model: "test-model",
        providerRegistry: registry,
      }),
    ).resolves.toEqual({
      status: "connected",
      providerId: "test-provider",
      modelId: "test-model",
      message: "Connected successfully.",
    });
  });
});
