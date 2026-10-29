import { describe, expect, it } from "vitest";
import {
  NodeProcessTreeTerminator,
  NodeProcessRunner,
} from "./process-runner.js";

describe("process runner platform contracts", () => {
  it("uses a bounded shell-free Windows tree termination command", async () => {
    const commands: unknown[] = [];
    const terminator = new NodeProcessTreeTerminator("win32", {
      async execute(file, args, options) {
        commands.push({ file, args, options });
      },
    });
    await terminator.terminate(12345, true);
    expect(commands).toEqual([
      {
        file: "taskkill",
        args: ["/PID", "12345", "/T", "/F"],
        options: { timeoutMs: 200, maxOutputBytes: 1024 },
      },
    ]);
  });

  it("does not spawn for a pre-aborted request", async () => {
    const result = await new NodeProcessRunner().run({
      command: "never execute",
      cwd: "/does-not-exist",
      timeoutMs: 100,
      signal: AbortSignal.abort(),
    });
    expect(result.outcome).toBe("aborted");
    expect(result.output).toBe("");
  });

  it("returns within its drain deadline even if an injected tree terminator stalls", async () => {
    const runner = new NodeProcessRunner({
      terminate: () => new Promise(() => {}),
    });
    const start = Date.now();
    // A finite synthetic child ensures test cleanup even when deliberately ignoring termination.
    const result = await runner.run({
      command: `${JSON.stringify(process.execPath)} -e "setTimeout(function(){}, 300)"`,
      cwd: process.cwd(),
      timeoutMs: 20,
      drainTimeoutMs: 30,
    });
    expect(Date.now() - start).toBeLessThan(250);
    expect(result.outcome).toBe("timeout");
  });
});
