import { describe, expect, it } from "vitest";
import { ApiKeyCredential, CredentialProviderRegistry } from "./credentials.js";

describe("credentials", () => {
  it("resolves bearer and custom-header API keys at request time", async () => {
    let key = "first";
    const bearer = new ApiKeyCredential("openai", () => key);
    const header = new ApiKeyCredential("custom", "secret", { kind: "header", name: "x-api-key" });

    await expect(bearer.resolve()).resolves.toEqual({ kind: "bearer", token: "first" });
    key = "second";
    await expect(bearer.resolve()).resolves.toEqual({ kind: "bearer", token: "second" });
    await expect(header.resolve()).resolves.toEqual({ kind: "header", name: "x-api-key", value: "secret" });
  });

  it("registers credential sources without a process-wide singleton", () => {
    const registry = new CredentialProviderRegistry();
    const credential = new ApiKeyCredential("cloud", "secret");
    registry.register(credential);

    expect(registry.require("cloud")).toBe(credential);
    expect(registry.list()).toEqual([credential]);
    expect(() => registry.register(credential)).toThrow("already registered");
    expect(() => registry.require("missing")).toThrow("not registered");
  });
});
