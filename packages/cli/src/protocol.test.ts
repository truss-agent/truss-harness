import { describe, expect, it } from "vitest";
import type { ToolCall } from "@truss-harness/runtime";
import { ProtocolToolApproval } from "./protocol.js";

const session = { id: "session", createdAt: new Date(), updatedAt: new Date(), messages: [] };
const readCall: ToolCall = { id: "read", name: "read_file", input: { path: "README.md" } };
const writeCall: ToolCall = { id: "write", name: "write_file", input: { path: "README.md", content: "updated" } };

describe("ProtocolToolApproval", () => {
  it("automatically permits only read tools in auto-read mode", async () => {
    const approval = new ProtocolToolApproval("auto-read");
    await expect(approval.approve(readCall, session)).resolves.toBe(true);

    const pending = approval.approve(writeCall, session);
    expect(approval.resolve("write", false)).toBe(true);
    await expect(pending).resolves.toBe(false);
  });

  it("automatically permits every tool in auto-all mode", async () => {
    const approval = new ProtocolToolApproval("auto-all");
    await expect(approval.approve(writeCall, session)).resolves.toBe(true);
  });
});
