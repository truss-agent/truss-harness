import { expect, it, vi } from "vitest";
vi.mock("vscode", () => ({
  Position: class {},
  Range: class {},
  InlineCompletionItem: class {},
}));
import { InlineCompletionController } from "./inline-completion.js";
import { InlineResponseBuffer } from "./inline-responses.js";
import type * as vscode from "vscode";
import type { RuntimeService } from "./runtime-service.js";
import type { ModelConfiguration } from "./contracts.js";
it("aborts an in-flight text-only helper on editor cancellation and cleans the buffer", async () => {
  let cancelled = false;
  let cancel: () => void = () => {};
  const disposed = vi.fn();
  const abort = vi.fn(() => {
    finish({
      type: "response",
      requestId: "helper",
      result: { aborted: true },
    });
  });
  let finish: (v: unknown) => void = () => {};
  const responses = new InlineResponseBuffer();
  const result = new Promise((resolve) => {
    finish = resolve;
  });
  const service = {
    run: vi.fn(() => ({ requestId: "helper", result })),
    generateText: vi.fn(() => ({ requestId: "helper", result })),
    abort,
  };
  const controller = new InlineCompletionController({
    configuration: () => ({ model: "fixture" }) as ModelConfiguration,
    service: async () => service as unknown as RuntimeService,
    responses,
  });
  const token = {
    get isCancellationRequested() {
      return cancelled;
    },
    onCancellationRequested(callback: () => void) {
      cancel = callback;
      return { dispose: disposed };
    },
  };
  const provider = controller as unknown as {
    provide: (...args: unknown[]) => Promise<unknown>;
  };
  const pending = provider.provide(
    {
      lineCount: 1,
      lineAt: () => ({ range: { end: { character: 0 } } }),
      getText: () => "",
    },
    { line: 0, character: 0 },
    {},
    token,
  );
  await Promise.resolve();
  cancelled = true;
  cancel();
  const state = await Promise.race([
    pending.then((v) => (v === undefined ? "cancelled" : "suggestion")),
    new Promise((r) => setTimeout(() => r("pending"), 20)),
  ]);
  expect(state).toBe("cancelled");
  expect(abort).toHaveBeenCalledOnce();
  expect(service.generateText).toHaveBeenCalledOnce();
  expect(service.run).not.toHaveBeenCalled();
  expect(disposed).toHaveBeenCalledOnce();
  expect(responses.value("helper")).toBeUndefined();
});
it("does not start a helper if cancellation arrives while the host connects", async () => {
  let cancelled = false;
  let resolveService: (v: RuntimeService) => void = () => {};
  const service = { generateText: vi.fn(), run: vi.fn() };
  const controller = new InlineCompletionController({
    configuration: () => ({ model: "fixture" }) as ModelConfiguration,
    service: () =>
      new Promise((r) => {
        resolveService = r;
      }),
    responses: new InlineResponseBuffer(),
  });
  const provider = controller as unknown as {
    provide: (...args: unknown[]) => Promise<unknown>;
  };
  const pending = provider.provide(
    {
      lineCount: 1,
      lineAt: () => ({ range: { end: { character: 0 } } }),
      getText: () => "",
    },
    { line: 0, character: 0 },
    {},
    {
      get isCancellationRequested() {
        return cancelled;
      },
      onCancellationRequested: () => ({ dispose() {} }),
    } as vscode.CancellationToken,
  );
  cancelled = true;
  resolveService(service as unknown as RuntimeService);
  await pending;
  expect(service.run).not.toHaveBeenCalled();
  expect(service.generateText).not.toHaveBeenCalled();
});
