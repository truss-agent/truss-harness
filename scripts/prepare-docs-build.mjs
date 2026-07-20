import { rm } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docsRoot = resolve(repositoryRoot, "packages", "docs");
const nextOutput = resolve(docsRoot, ".next");

if (relative(docsRoot, nextOutput).startsWith("..")) {
  throw new Error("Refusing to clear a Docs build output outside the Docs workspace.");
}

await rm(nextOutput, { force: true, recursive: true });
