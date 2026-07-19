import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

const server = new McpServer({ name: "truss-test-server", version: "1.0.0" });

server.registerTool("echo-value", {
  description: "Echo a value with the configured prefix.",
  inputSchema: {
    value: z.string(),
  },
}, async ({ value }) => ({
  content: [{ type: "text", text: `${process.env.TRUSS_TEST_PREFIX ?? "missing"}:${value}` }],
}));

await server.connect(new StdioServerTransport());
