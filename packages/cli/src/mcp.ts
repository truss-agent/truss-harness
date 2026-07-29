import type { McpServerStatus } from "@truss-harness/mcp";

/** Formats credential-safe MCP state for CLI and terminal-client surfaces. */
export function formatMcpStatuses(
  statuses: readonly McpServerStatus[],
  options: { readonly includeTools?: boolean } = {},
): string {
  if (!statuses.length) return "No MCP servers configured.";

  return statuses
    .flatMap((status) => {
      const detail = status.error
        ? ` — ${status.error}`
        : status.state === "connected"
          ? ` — ${status.toolCount} tool${status.toolCount === 1 ? "" : "s"}`
          : "";
      const lines = [`${status.name}\t${status.state}${detail}`];
      if (options.includeTools) {
        for (const tool of status.tools ?? []) {
          lines.push(
            `  ${tool.name}\t${tool.readOnly ? "read-only" : "approval-controlled"}${tool.description ? `\t${tool.description}` : ""}`,
          );
        }
      }
      return lines;
    })
    .join("\n");
}
