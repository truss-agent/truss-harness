import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(packageRoot, "src");
const output = resolve(packageRoot, "dist");

await mkdir(output, { recursive: true });
await Promise.all([
  cp(resolve(source, "index.html"), resolve(output, "index.html")),
  cp(resolve(source, "styles.css"), resolve(output, "styles.css")),
  cp(resolve(packageRoot, "assets"), resolve(output, "assets"), { recursive: true })
]);
