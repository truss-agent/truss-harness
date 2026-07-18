import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const electronBinary = require("electron");
const environment = { ...process.env };

delete environment.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinary, ["."], {
  cwd: process.cwd(),
  env: environment,
  stdio: "inherit"
});

child.once("exit", (code) => process.exit(code ?? 0));
child.once("error", (error) => {
  console.error(`Unable to launch Electron: ${error.message}`);
  process.exit(1);
});
