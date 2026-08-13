import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = fileURLToPath(new URL(".", import.meta.url));
const forbiddenPackages = [
  "@truss-harness/agent-host",
  "@truss-harness/cli",
  "@truss-harness/gateway",
  "@truss-harness/mcp",
  "@truss-harness/provider-openai-compatible",
  "electron",
  "ink",
  "react",
  "react-native",
  "vscode",
] as const;

async function productionSources(directory: string): Promise<readonly string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await productionSources(candidate)));
    else if (extname(entry.name) === ".ts" && !entry.name.endsWith(".test.ts")) {
      files.push(candidate);
    }
  }
  return files;
}

describe("runtime architecture", () => {
  it("does not import host, provider, protocol, or client packages", async () => {
    const violations: string[] = [];
    for (const file of await productionSources(sourceRoot)) {
      const source = await readFile(file, "utf8");
      for (const dependency of forbiddenPackages) {
        const quoted = [`"${dependency}"`, `'${dependency}'`];
        if (quoted.some((specifier) => source.includes(specifier))) {
          violations.push(`${file.slice(sourceRoot.length)} -> ${dependency}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
