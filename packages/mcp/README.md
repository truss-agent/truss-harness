# Truss MCP Adapter

Connects configured local stdio Model Context Protocol servers to the Truss
tool registry. MCP tools retain the runtime's normal approval workflow and are
namespaced by server name.

```ts
import { registerMcpServers } from "@truss-harness/mcp";
import { ToolRegistry } from "@truss-harness/runtime";

const tools = new ToolRegistry();
const connections = await registerMcpServers(tools, {
  filesystem: {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
    readOnly: true
  }
}, { workspaceRoot: process.cwd() });

await connections.close();
```

Configuration supports `command`, `args`, workspace-relative `cwd`, `env`,
`enabled`, and `readOnly`. Environment values can reference
`${env:VARIABLE_NAME}`. Server startup and tool discovery are bounded, one
failed server does not prevent other servers from connecting, and callers own
the returned lifecycle.
