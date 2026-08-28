import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { CLI_VERSION, formatCliVersion } from "./version.js";

describe("CLI_VERSION", () => {
  it("matches the published package version", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { readonly version: string };
    expect(CLI_VERSION).toBe(packageJson.version);
  });

  it("formats the side-effect-free CLI health probe", () => {
    expect(formatCliVersion("truss-cli")).toBe("truss-cli 0.1.22");
  });
});
