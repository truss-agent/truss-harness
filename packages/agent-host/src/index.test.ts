import { describe, expect, it } from "vitest";
import type {
  AgentProfile,
  CredentialProvider,
  ModelProvider,
  ModelRequest,
  ModelStreamEvent,
} from "@truss-harness/runtime";
import {
  AgentHost,
  AgentProviderRegistry,
  createDefaultAgentProviderRegistry,
  type AgentProviderFactory,
} from "./index.js";

function profile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: "reviewer",
    displayName: "Reviewer",
    provider: {
      providerId: "test-provider",
      endpointUrl: "http://127.0.0.1:8080/v1",
      modelId: "test-model",
      credentialRef: "credential-reviewer",
    },
    mode: "chat",
    approvalPolicy: "ask",
    internetAccess: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function testProviderFactory(
  created: AgentProfile["provider"][],
): AgentProviderFactory {
  return {
    descriptor: {
      id: "test-provider",
      label: "Test provider",
      requiresCredential: true,
    },
    async validate(binding, context) {
      if (!binding.modelId) throw new Error("A model is required.");
      if (!context.credential) throw new Error("A credential is required.");
    },
    async create(binding) {
      created.push(binding);
      return {
        id: `test:${binding.endpointUrl}:${binding.modelId}`,
        async *stream(_request: ModelRequest): AsyncIterable<ModelStreamEvent> {
          yield { type: "text_delta", text: `hello from ${binding.modelId}` };
          yield { type: "finish", reason: "stop" };
        },
      } satisfies ModelProvider;
    },
  };
}

describe("AgentHost", () => {
  it("resolves opaque credential references and routes each profile to its bound provider", async () => {
    const created: AgentProfile["provider"][] = [];
    const registry = new AgentProviderRegistry();
    registry.register(testProviderFactory(created));
    const references: string[] = [];
    const credential: CredentialProvider = {
      id: "secure-store:reviewer",
      async resolve() {
        return { kind: "bearer", token: "not-exposed-to-profile" };
      },
    };
    const host = new AgentHost({
      workspaceRoot: process.cwd(),
      providerRegistry: registry,
      credentialResolver: {
        async resolve(reference) {
          references.push(reference);
          return credential;
        },
      },
    });
    const agent = profile();

    const hosted = await host.createRuntime(agent);
    const text: string[] = [];
    const unsubscribe = hosted.events.subscribe((event) => {
      if (event.type === "text_delta") text.push(event.text);
    });
    const session = await hosted.runtime.createSession();
    await hosted.runtime.run(session.id, "Say hello.");
    unsubscribe();
    await hosted.dispose();

    expect(references).toEqual(["credential-reviewer"]);
    expect(created).toEqual([agent.provider]);
    expect(text).toEqual(["hello from test-model"]);
  });

  it("creates coordinator-compatible runtimes without asking for approval twice", async () => {
    const registry = new AgentProviderRegistry();
    registry.register(testProviderFactory([]));
    let approvalFactoryCalls = 0;
    const approval = {
      async approve() {
        return true;
      },
      resolve() {
        return true;
      },
      denyAll() {},
    };
    const host = new AgentHost({
      workspaceRoot: process.cwd(),
      providerRegistry: registry,
      credentialResolver: {
        async resolve() {
          return {
            id: "credential",
            async resolve() {
              return { kind: "bearer", token: "secret" };
            },
          };
        },
      },
      approvalFactory() {
        approvalFactoryCalls += 1;
        return approval;
      },
    });

    const created = await host.createRuntimeFactory().create(profile());
    expect(created.approval).toBe(approval);
    expect(approvalFactoryCalls).toBe(1);
    await created.dispose();
  });

  it("tests a provider connection through the selected provider without exposing its credential", async () => {
    const created: AgentProfile["provider"][] = [];
    const registry = new AgentProviderRegistry();
    registry.register(testProviderFactory(created));
    const host = new AgentHost({
      workspaceRoot: process.cwd(),
      providerRegistry: registry,
      credentialResolver: {
        async resolve() {
          return {
            id: "credential",
            async resolve() {
              return { kind: "bearer", token: "not-exposed" };
            },
          };
        },
      },
    });

    await expect(host.testProviderConnection(profile().provider)).resolves.toEqual({
      status: "connected",
      providerId: "test-provider",
      modelId: "test-model",
      message: "Connected successfully.",
    });
    expect(created).toEqual([profile().provider]);
  });

  it("maps safe provider connection failures without exposing upstream details", async () => {
    const registry = new AgentProviderRegistry();
    registry.register({
      descriptor: { id: "test-provider", label: "Test provider", requiresCredential: true },
      async validate() {},
      async create() {
        return {
          id: "test-provider",
          async *stream(): AsyncIterable<ModelStreamEvent> {
            throw new Error("Model request failed (402). sensitive upstream details");
          },
        } satisfies ModelProvider;
      },
    });
    const host = new AgentHost({
      workspaceRoot: process.cwd(),
      providerRegistry: registry,
    });

    await expect(host.testProviderConnection(profile().provider)).resolves.toEqual({
      status: "payment_required",
      providerId: "test-provider",
      modelId: "test-model",
      message: "The API key was accepted, but this account or key has insufficient credit.",
    });
  });

  it("registers distinct local endpoint adapters alongside cloud providers", () => {
    const providerIds = createDefaultAgentProviderRegistry()
      .list()
      .map((provider) => provider.id);

    expect(providerIds).toContain("ollama");
    expect(providerIds).toContain("openai-compatible");
    expect(providerIds).toContain("llama-cpp");
    expect(providerIds).toContain("openai");
  });
});
