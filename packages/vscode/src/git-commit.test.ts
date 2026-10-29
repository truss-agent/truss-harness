import { expect, it, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const progress = vi.hoisted(() => ({ callback: undefined as unknown }));
vi.mock("vscode", () => ({
  ProgressLocation: { SourceControl: 1 },
  window: {
    withProgress: (_options: unknown, callback: unknown) => {
      progress.callback = callback;
      return (callback as (p: unknown, t: unknown) => unknown)(
        {},
        {
          isCancellationRequested: false,
          onCancellationRequested: () => ({ dispose() {} }),
        },
      );
    },
  },
}));
import { GitCommitController } from "./git-commit.js";
import { InlineResponseBuffer } from "./inline-responses.js";
import type { RuntimeService } from "./runtime-service.js";
import type * as vscode from "vscode";
it("generates commit messages through the negotiated text-only helper", async () => {
  const root = await mkdtemp(join(tmpdir(), "truss-commit-helper-"));
  await exec("git", ["init", "-q"], { cwd: root });
  await writeFile(join(root, "a"), "change");
  await exec("git", ["add", "a"], { cwd: root });
  const responses = new InlineResponseBuffer();
  const result = Promise.resolve({
    type: "response",
    requestId: "helper",
    result: {},
  });
  const service = {
    generateText: vi.fn(() => ({ requestId: "helper", result })),
    run: vi.fn(() => ({
      requestId: "helper",
      result: Promise.resolve().then(() => {
        responses.append("helper", "fix: preserve staged selection");
        return { type: "response", requestId: "helper", result: {} };
      }),
    })),
    abort: vi.fn(),
  };
  const controller = new GitCommitController(
    () => root,
    async () => service as unknown as RuntimeService,
    responses,
    {} as vscode.OutputChannel,
  ) as unknown as { generate(): Promise<string> };
  // Stream after the helper registers its response buffer.
  service.generateText.mockImplementation(() => ({
    requestId: "helper",
    result: Promise.resolve().then(() => {
      responses.append("helper", "fix: preserve staged selection");
      return { type: "response", requestId: "helper", result: {} };
    }),
  }));
  expect(await controller.generate()).toBe("fix: preserve staged selection");
  expect(service.generateText).toHaveBeenCalledOnce();
  expect(service.run).not.toHaveBeenCalled();
  expect(responses.value("helper")).toBeUndefined();
  await rm(root, { recursive: true, force: true });
});
