import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const electronBinary = require("electron");
const environment = { ...process.env };
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
delete environment.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinary, ["."], {
  cwd: packageRoot,
  env: environment,
  stdio: "inherit",
});
child.once("exit", (code) => process.exit(code ?? 0));
child.once("error", (error) => {
  console.error(`Unable to launch Electron: ${error.message}`);
  process.exit(1);
});
