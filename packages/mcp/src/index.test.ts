import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ToolRegistry } from "@truss-harness/runtime";
import { McpServerManager, registerMcpServers } from "./index.js";

const fixture = resolve(dirname(fileURLToPath(import.meta.url)), "../test/fixture-server.mjs");

describe("MCP tool adapter", () => {
  it("discovers, namespaces, invokes, and closes stdio tools", async () => {
    const registry = new ToolRegistry();
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

    expect(connections.statuses).toEqual([{
      name: "fixture",
      state: "connected",
      toolCount: 1,
      tools: [{ name: "echo-value", description: "Echo a value with the configured prefix.", readOnly: false }],
    }]);
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

  it("tracks disabled servers and removes stale tools during reconnect", async () => {
    const registry = new ToolRegistry();
    const manager = new McpServerManager(registry, {
      disabled: { command: process.execPath, args: [fixture], enabled: false },
      fixture: { command: process.execPath, args: [fixture], readOnly: true },
    }, { workspaceRoot: process.cwd() });
    const snapshots: string[][] = [];
    const unsubscribe = manager.subscribe((statuses) => snapshots.push(statuses.map((status) => status.state)));

    await manager.connectAll();
    expect(manager.statuses).toMatchObject([
      { name: "disabled", state: "disabled", toolCount: 0 },
      { name: "fixture", state: "connected", toolCount: 1, tools: [{ name: "echo-value", readOnly: true }] },
    ]);
    expect(registry.get("mcp_fixture_echo-value")).toBeDefined();

    await manager.disconnect("fixture");
    expect(registry.get("mcp_fixture_echo-value")).toBeUndefined();
    await manager.reconnect("fixture");
    expect(registry.get("mcp_fixture_echo-value")).toBeDefined();
    expect(snapshots.some((states) => states.includes("connecting"))).toBe(true);

    unsubscribe();
    await manager.close();
  }, 15_000);
});
