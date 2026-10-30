import { describe, expect, it, vi } from "vitest";
import { herdrAgentStatus, type RunReport } from "./agent-status.js";

const herdr = {
  HERDR_ENV: "1",
  HERDR_PANE_ID: "w1:p2",
  HERDR_BIN_PATH: "/usr/bin/herdr",
};

describe("herdr agent status", () => {
  it("does nothing outside a Herdr pane", () => {
    expect(herdrAgentStatus({})).toBeUndefined();
    expect(herdrAgentStatus({ ...herdr, HERDR_ENV: "0" })).toBeUndefined();
  });

  it("reports state, resume command and release with rising sequence numbers", async () => {
    const run = vi.fn<RunReport>(async () => {});
    let clock = 1_000;
    const status = herdrAgentStatus(herdr, run, () => clock);
    status?.state("working");
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    clock = 500; // A clock step backwards must not lower the sequence.
    status?.resumeCommand("abc-123", ["truss-cli", "--resume", "abc-123"]);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    await status?.release();
    const calls = run.mock.calls.map(([file, args]) => [file, ...args]);
    expect(calls[0]).toEqual([
      "/usr/bin/herdr",
      "pane",
      "report-agent",
      "w1:p2",
      "--source",
      "truss-cli",
      "--agent",
      "truss",
      "--state",
      "working",
      "--seq",
      "1000",
    ]);
    expect(calls[1]?.slice(-6)).toEqual([
      "--agent-session-id",
      "abc-123",
      "--",
      "truss-cli",
      "--resume",
      "abc-123",
    ]);
    expect(calls[1]?.[11]).toBe("1001");
    expect(calls[2]?.slice(1, 4)).toEqual(["pane", "release-agent", "w1:p2"]);
    expect(calls[2]?.at(-1)).toBe("1002");
  });

  it("sends only the latest state while a report is in flight", async () => {
    let finish!: () => void;
    const run = vi.fn<RunReport>(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const status = herdrAgentStatus(herdr, run, () => 1);
    status?.state("working");
    status?.state("blocked", "Allow run_terminal?");
    status?.state("idle");
    finish();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    finish();
    expect(run.mock.calls[1]?.[1]).toContain("idle");
    expect(run.mock.calls[1]?.[1]).not.toContain("--message");
  });

  it("ignores report failures and resume commands Herdr would reject", async () => {
    const run = vi.fn<RunReport>(async () => {
      throw new Error("herdr is gone");
    });
    const status = herdrAgentStatus(herdr, run, () => 1);
    status?.resumeCommand(undefined, ["truss-cli", "--profile", "it's"]);
    expect(run).not.toHaveBeenCalled();
    status?.state("working");
    await expect(status?.release()).resolves.toBeUndefined();
  });
});
