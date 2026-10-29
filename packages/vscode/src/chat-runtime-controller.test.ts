import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { expect, it, vi } from "vitest";
import type * as vscode from "vscode";
const fake = vi.hoisted(() => ({
  children: [] as Array<EventEmitter & { stdout: PassThrough }>,
}));
vi.mock("vscode", () => ({
  ExtensionMode: { Development: 1 },
  window: { visibleTextEditors: [], activeTextEditor: undefined },
  workspace: { getConfiguration: () => ({ get: () => "" }) },
}));
vi.mock("./runtime-host-resolution.js", () => ({
  resolveRuntimeHostLaunch: async () => ({
    command: "fixture",
    arguments: [],
    requiresNodeEnvironment: false,
  }),
}));
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  spawn: () => {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill() {},
    });
    fake.children.push(child);
    child.stdin.on("data", (data) => {
      const request = JSON.parse(String(data));
      const reply = (result: unknown) =>
        child.stdout.write(
          JSON.stringify({
            type: "response",
            requestId: request.requestId,
            result,
          }) + "\n",
        );
      if (request.type === "initialize")
        reply({
          protocolVersion: 1,
          server: {
            name: "truss-cli",
            version: "test",
            identity: {
              runtime: {
                packageName: "@truss-harness/runtime",
                version: "0.1.0",
              },
              protocolVersions: [1],
            },
          },
        });
      else if (request.type === "create_session")
        reply({ sessionId: "session" });
      else if (request.type === "run") {
        child.stdout.write(
          JSON.stringify({
            type: "approval_request",
            requestId: request.requestId,
            sessionId: "session",
            callId: "call",
            tool: "read_file",
            input: {},
          }) + "\n",
        );
        reply({ sessionId: "session" });
      }
    });
    return child;
  },
}));
import { ChatRuntimeController } from "./chat-runtime-controller.js";
import { InlineResponseBuffer } from "./inline-responses.js";
import type { ModelConfiguration } from "./contracts.js";
it("ends approved conversations and starts a fresh host after exit", async () => {
  const messages: Array<{ type: string; message?: string }> = [];
  const controller = new ChatRuntimeController({
    context: {
      extensionMode: 1,
      subscriptions: [],
      extensionPath: "/fixture",
      globalStorageUri: { fsPath: "/fixture" },
    } as unknown as vscode.ExtensionContext,
    output: { append() {}, appendLine() {} } as unknown as vscode.OutputChannel,
    configuration: () =>
      ({ model: "fixture", permission: "ask" }) as ModelConfiguration,
    runtimeEnvironment: async () => ({}),
    workspaceRoot: () => "/tmp",
    responses: new InlineResponseBuffer(),
  });
  controller.attach({
    webview: {
      postMessage: (message: (typeof messages)[number]) => {
        messages.push(message);
        return Promise.resolve(true);
      },
    },
  } as unknown as vscode.WebviewView);
  await controller.sendPrompt("Explain the project", "conversation", []);
  expect(messages.filter((m) => m.type === "assistantEnd")).toHaveLength(1);
  await controller.sendPrompt("Continue explanation", "conversation", []);
  expect(messages.filter((m) => m.type === "assistantEnd")).toHaveLength(2);
  expect(messages.filter((m) => m.type === "error")).toEqual([]);
  const first = await controller.service();
  fake.children.at(-1)!.emit("exit", 1);
  const next = await controller.service();
  expect(next).not.toBe(first);
  await next.waitUntilReady();
  controller.dispose();
});
