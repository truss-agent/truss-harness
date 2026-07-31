import { describe, expect, it, vi } from "vitest";
import { recoverStartupRuntime } from "./startup-runtime.js";

describe("recoverStartupRuntime", () => {
  it("recovers from an expired provider credential instead of rejecting startup", async () => {
    const credentialError = new Error(
      "OpenRouter requires a configured credential.",
    );
    const dispose = vi.fn().mockResolvedValue(undefined);

    await expect(
      recoverStartupRuntime(
        async () => Promise.reject(credentialError),
        dispose,
      ),
    ).resolves.toEqual({ status: "recovered", error: credentialError });
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("keeps the original startup error recoverable when cleanup also fails", async () => {
    const credentialError = new Error(
      "OpenRouter requires a configured credential.",
    );

    await expect(
      recoverStartupRuntime(
        async () => Promise.reject(credentialError),
        async () => Promise.reject(new Error("cleanup failed")),
      ),
    ).resolves.toEqual({ status: "recovered", error: credentialError });
  });
});
