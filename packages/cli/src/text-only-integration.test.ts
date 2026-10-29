import { expect, it } from "vitest";
import { AgentProviderRegistry } from "@truss-harness/agent-host";
import type { ModelStreamEvent } from "@truss-harness/runtime";
import { createClientRuntime } from "./runtime.js";
import {
  ProtocolToolApproval,
  RuntimeService,
  type RuntimeServiceMessage,
} from "./protocol.js";

it.each(["write_file", "run_terminal"])(
  "rejects %s emitted by a helper provider through the actual host/protocol",
  async (tool) => {
    let exposedTools: readonly unknown[] | undefined;
    const providers = new AgentProviderRegistry();
    providers.register({
      descriptor: {
        id: "openai-compatible",
        label: "Fixture",
        requiresCredential: false,
      },
      async validate() {},
      async create() {
        return {
          id: "fixture",
          async *stream(request): AsyncIterable<ModelStreamEvent> {
            exposedTools = request.tools;
            yield {
              type: "tool_call",
              id: "forbidden",
              name: tool,
              input: {
                path: "sentinel",
                content: "bad",
                command: "touch sentinel",
              },
            };
          },
        };
      },
    });
    const configuration = {
      workspaceRoot: process.cwd(),
      provider: "openai-compatible" as const,
      baseUrl: "http://fixture.invalid",
      model: "fixture",
      providerRegistry: providers,
      mode: "edit" as const,
    };
    const approval = new ProtocolToolApproval("auto-all");
    const client = await createClientRuntime({ ...configuration, approval });
    const textClient = await createClientRuntime({
      ...configuration,
      textOnly: true,
    });
    const messages: RuntimeServiceMessage[] = [];
    const service = new RuntimeService({
      runtime: client.runtime,
      events: client.events,
      approval,
      textRuntime: textClient,
      write: (message) => messages.push(message as RuntimeServiceMessage),
    });
    try {
      await service.handleLine(
        JSON.stringify({
          type: "initialize",
          requestId: "init",
          protocolVersions: [1],
        }),
      );
      await service.handleLine(
        JSON.stringify({
          type: "run",
          requestId: "helper",
          prompt: "complete",
          textOnly: true,
        }),
      );
      for (
        let i = 0;
        i < 100 &&
        !messages.some((m) => m.type === "error" && m.requestId === "helper");
        i++
      )
        await new Promise((resolve) => setTimeout(resolve, 2));
      expect(messages).toContainEqual(
        expect.objectContaining({
          type: "error",
          requestId: "helper",
          message: expect.stringMatching(/text.only/i),
        }),
      );
      expect(exposedTools).toEqual([]);
      expect(
        messages.some(
          (m) =>
            m.type === "approval_request" ||
            (m.type === "event" && m.event.type === "tool_call_requested"),
        ),
      ).toBe(false);
    } finally {
      await service.close();
      await textClient.dispose();
      await client.dispose();
    }
  },
);
