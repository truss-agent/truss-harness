import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const dist = resolve(import.meta.dirname, "../packages/vscode/dist");
await Promise.all([
  rm(resolve(dist, "extension.js"), { force: true }),
  rm(resolve(dist, "extension.cjs"), { force: true })
]);
