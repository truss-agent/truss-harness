import { expect, it } from "vitest";
import { validDesktopIpcInput } from "./ipc-input.js";
it.each([
  ["truss:update-agent", ["agent", { displayName: 42 }]],
  ["truss:update-provider-account", ["account", { scopes: "admin" }]],
  ["truss:discover-models", [{ provider: 42 }]],
  ["truss:save-workspace-ui-state", [{ expandedDirectories: 42 }]],
  ["truss:configure-theme", [{ name: "custom", custom: { background: 42 } }]],
])("rejects malformed nested fields on %s", (channel, args) => {
  expect(validDesktopIpcInput(channel, args)).toBe(false);
});
it.each([
  ["truss:configure-theme", [{ name: "blue" }]],
  ["truss:adjust-zoom", [-1]],
  ["truss:update-agent", ["agent", { instructions: "inspect code" }]],
  [
    "truss:save-provider-account",
    [
      { providerId: "anthropic", label: "Work", authMethod: "api-key" },
      "synthetic-key",
    ],
  ],
  [
    "truss:save-workspace-ui-state",
    [{ expandedDirectories: [], openEditors: [], fileTreeScrollTop: 0 }],
  ],
])("accepts the native bridge shape on %s", (channel, args) => {
  expect(validDesktopIpcInput(channel, args)).toBe(true);
});
