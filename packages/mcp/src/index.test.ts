import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ToolRegistry } from "@truss-harness/runtime";
import { registerMcpServers } from "./index.js";

describe("MCP tool adapter", () => {
  it("discovers, namespaces, invokes, and closes stdio tools", async () => {
    const registry = new ToolRegistry();
    const fixture = resolve(dirname(fileURLToPath(import.meta.url)), "../test/fixture-server.mjs");
    const connections = await registerMcpServers(registry, {
      fixture: {
        command: process.execPath,
        args: [fixture],
        env: { TRUSS_TEST_PREFIX: "${env:TRUSS_TEST_SOURCE}" },
      },
    }, {
      workspaceRoot: process.cwd(),
      environment: { ...process.env, TRUSS_TEST_SOURCE: "configured" },
    });

    expect(connections.statuses).toEqual([
      { name: "fixture", state: "connected", toolCount: 1 },
    ]);
    expect(registry.definitions()[0]).toMatchObject({
      name: "mcp_fixture_echo-value",
      description: "[MCP: fixture] Echo a value with the configured prefix.",
    });

    const result = await registry.get("mcp_fixture_echo-value")?.execute(
      { value: "hello" },
      { workspaceRoot: process.cwd() },
    );
    expect(result).toEqual({ content: "configured:hello", isError: undefined });

    await connections.close();
  }, 15_000);
});
