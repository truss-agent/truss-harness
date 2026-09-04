import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await mkdir(resolve(root, "dist"), { recursive: true });
await Promise.all([
  cp(resolve(root, "src/index.html"), resolve(root, "dist/index.html")),
  cp(resolve(root, "src/styles.css"), resolve(root, "dist/styles.css")),
]);
