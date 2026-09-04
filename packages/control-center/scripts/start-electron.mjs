import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const electron = process.platform === "win32" ? "electron.cmd" : "electron";
spawn(electron, ["."], { cwd: root, stdio: "inherit", shell: process.platform === "win32" }).on("exit", (code) => process.exit(code ?? 0));
