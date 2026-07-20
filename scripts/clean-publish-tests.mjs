import { readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packages = ["runtime", "mcp", "provider-openai-compatible", "cli", "tui"];

async function cleanPublishArtifacts(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
  await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".truss-harness") return rm(path, { recursive: true, force: true });
      return cleanPublishArtifacts(path);
    }
    if (/\.test\.(?:js|d\.ts)$/.test(entry.name)) await rm(path, { force: true });
  }));
}

await Promise.all(packages.map((packageName) => cleanPublishArtifacts(join(root, "packages", packageName, "dist"))));
process.stdout.write("Removed generated test modules and local workspace state from publish artifacts.\n");
