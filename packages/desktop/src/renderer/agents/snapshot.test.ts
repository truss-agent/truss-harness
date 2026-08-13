import { describe, expect, it } from "vitest";
import type { DesktopAgentsSnapshot } from "../../shared.js";
import { markChangedAgentRuns } from "./snapshot.js";

function snapshot(
  state: DesktopAgentsSnapshot["runs"][number]["state"],
  changedFiles: readonly string[],
): DesktopAgentsSnapshot {
  return {
    profiles: [],
    runs: [
      {
        id: "run-1",
        agentId: "agent-1",
        state,
        prompt: "Update the workspace",
        changedFiles,
      },
    ],
  };
}

describe("managed-agent workspace refreshes", () => {
  it("requests one refresh for a newly completed run with file changes", () => {
    const reflected = new Set<string>();
    const completed = snapshot("completed", ["src/index.ts"]);

    expect(markChangedAgentRuns(completed, reflected)).toBe(true);
    expect(markChangedAgentRuns(completed, reflected)).toBe(false);
  });

  it("ignores active and unchanged runs", () => {
    const reflected = new Set<string>();

    expect(
      markChangedAgentRuns(snapshot("running", ["src/index.ts"]), reflected),
    ).toBe(false);
    expect(markChangedAgentRuns(snapshot("completed", []), reflected)).toBe(
      false,
    );
  });
});
