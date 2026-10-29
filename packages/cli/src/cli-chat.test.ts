import { createInterface } from "node:readline/promises";
import { PassThrough } from "node:stream";
import { expect, it } from "vitest";
import { withCliChatResources } from "./cli-chat.js";
import { createClientRuntime, type ClientConfiguration } from "./runtime.js";

const configuration: ClientConfiguration = {
  workspaceRoot: process.cwd(),
  provider: "ollama",
  model: "fixture",
  baseUrl: "http://127.0.0.1:11434",
  mode: "chat",
};

it("closes the acquired readline owner when actual provider initialization rejects", async () => {
  const readline = createInterface({
    input: new PassThrough(),
    output: new PassThrough(),
  });
  let closed = false;
  readline.once("close", () => {
    closed = true;
  });
  await expect(
    withCliChatResources(
      { permission: "ask", canPrompt: true, createReadline: () => readline },
      async (resources) => {
        await resources.createRuntime({ ...configuration, baseUrl: "invalid" });
      },
    ),
  ).rejects.toThrow(/valid HTTP or HTTPS/);
  expect(closed).toBe(true);
});

it("partial chat initialization closes stdin and awaits the already-acquired runtime disposal", async () => {
  const readline = createInterface({
    input: new PassThrough(),
    output: new PassThrough(),
  });
  let closed = false;
  readline.once("close", () => {
    closed = true;
  });
  let releaseDispose!: () => void;
  const disposeGate = new Promise<void>((resolve) => {
    releaseDispose = resolve;
  });
  let startedDispose!: () => void;
  const disposing = new Promise<void>((resolve) => {
    startedDispose = resolve;
  });
  let disposed = false;
  const operation = withCliChatResources(
    {
      permission: "ask",
      canPrompt: true,
      createReadline: () => readline,
      runtimeFactory: async (options) => {
        const client = await createClientRuntime(options);
        return {
          ...client,
          async dispose() {
            startedDispose();
            await disposeGate;
            await client.dispose();
            disposed = true;
          },
        };
      },
    },
    async (resources) => {
      await resources.createRuntime(configuration);
      throw new Error("Session initialization failed after runtime creation");
    },
  );
  const rejection = expect(operation).rejects.toThrow(
    "Session initialization failed",
  );
  await disposing;
  expect(closed).toBe(true);
  expect(disposed).toBe(false);
  releaseDispose();
  await rejection;
  expect(disposed).toBe(true);
});
