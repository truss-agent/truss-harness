import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { CLI_VERSION } from "./version.js";

describe("CLI_VERSION", () => {
  it("matches the published package version", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { readonly version: string };
    expect(CLI_VERSION).toBe(packageJson.version);
  });
});
