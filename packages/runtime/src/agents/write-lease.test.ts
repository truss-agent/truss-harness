import { describe, expect, it } from "vitest";
import { InMemoryWorkspaceWriteLease } from "./write-lease.js";

describe("InMemoryWorkspaceWriteLease", () => {
  it("allows one run to hold and release the workspace write lease", () => {
    const lease = new InMemoryWorkspaceWriteLease();

    expect(lease.tryAcquire("run-a")).toBe(true);
    expect(lease.holder()).toBe("run-a");
    expect(lease.tryAcquire("run-a")).toBe(true);
    expect(lease.tryAcquire("run-b")).toBe(false);
    expect(lease.release("run-b")).toBe(false);
    expect(lease.release("run-a")).toBe(true);
    expect(lease.holder()).toBeUndefined();
    expect(lease.tryAcquire("run-b")).toBe(true);
  });
});
