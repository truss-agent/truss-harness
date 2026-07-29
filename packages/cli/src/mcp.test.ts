import { describe, expect, it } from "vitest";
import { formatMcpStatuses } from "./mcp.js";

describe("formatMcpStatuses", () => {
  it("prints safe lifecycle and optional tool details", () => {
    const statuses = [
      {
        name: "filesystem",
        state: "connected" as const,
        toolCount: 1,
        tools: [
          {
            name: "read_file",
            description: "Read a workspace file.",
            readOnly: true,
          },
        ],
      },
      {
        name: "missing",
        state: "failed" as const,
        toolCount: 0,
        error: "The configured executable could not be started.",
      },
    ];

    expect(formatMcpStatuses(statuses)).toBe(
      "filesystem\tconnected — 1 tool\n" +
        "missing\tfailed — The configured executable could not be started.",
    );
    expect(formatMcpStatuses(statuses, { includeTools: true })).toContain(
      "  read_file\tread-only\tRead a workspace file.",
    );
  });

  it("handles an empty configuration", () => {
    expect(formatMcpStatuses([])).toBe("No MCP servers configured.");
  });
});
