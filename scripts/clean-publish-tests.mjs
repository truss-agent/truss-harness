import { readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packages = ["runtime", "provider-openai-compatible", "cli"];

async function removeTests(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
  await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return removeTests(path);
    if (/\.test\.(?:js|d\.ts)$/.test(entry.name)) await rm(path, { force: true });
  }));
}

await Promise.all(packages.map((packageName) => removeTests(join(root, "packages", packageName, "dist"))));
process.stdout.write("Removed generated test modules from publish artifacts.\n");
