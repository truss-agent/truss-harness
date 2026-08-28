import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { RUNTIME_PACKAGE_NAME, RUNTIME_VERSION } from "./version.js";

describe("runtime release identity", () => {
  it("matches the published package metadata", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { readonly name: string; readonly version: string };

    expect(RUNTIME_PACKAGE_NAME).toBe(packageJson.name);
    expect(RUNTIME_VERSION).toBe(packageJson.version);
  });
});
