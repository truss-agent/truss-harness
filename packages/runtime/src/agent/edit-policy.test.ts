import { describe, expect, it } from "vitest";
import {
  hasEditIntent,
  isFileWrite,
  recoveryInstruction,
  turnBudgetInstruction,
  workspacePath,
} from "./edit-policy.js";

describe("agent edit policy", () => {
  it("recognizes edit requests and write-tool paths", () => {
    expect(hasEditIntent("Please refactor the runtime coordinator")).toBe(true);
    expect(hasEditIntent("Explain how the runtime coordinator works")).toBe(
      false,
    );
    const write = {
      type: "tool_call" as const,
      id: "call-1",
      name: "replace_in_file",
      input: { path: "src/index.ts" },
    };
    expect(isFileWrite(write)).toBe(true);
    expect(workspacePath(write)).toBe("src/index.ts");
  });

  it("builds recovery and turn-budget instructions only when required", () => {
    expect(recoveryInstruction(undefined, new Set())).toBeUndefined();
    expect(
      recoveryInstruction("write_failed", new Set(["src/index.ts"])),
    ).toContain("src/index.ts");
    expect(recoveryInstruction("no_tools", new Set())).toContain(
      "EXECUTION RECOVERY",
    );
    expect(turnBudgetInstruction(7)).toBeUndefined();
    expect(turnBudgetInstruction(6)).toContain("6 turns remain");
  });
});
