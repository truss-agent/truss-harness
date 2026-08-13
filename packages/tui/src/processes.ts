import {
  type ChildProcess,
  execFile as execFileCallback,
  spawn,
} from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export async function runTrackedCommand(
  command: string,
  workspaceRoot: string,
  onOutput: (output: string) => void,
  onProcess?: (process: ChildProcess | undefined) => void,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, {
      cwd: workspaceRoot,
      shell: true,
      windowsHide: true,
    });
    onProcess?.(child);
    child.stdout.on("data", (data: Buffer) => onOutput(data.toString()));
    child.stderr.on("data", (data: Buffer) => onOutput(data.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      onProcess?.(undefined);
      onOutput(`\n[process exited: ${code ?? "unknown"}]\n`);
      resolve();
    });
  });
}

export function detectedPreviewUrl(output: string): string | undefined {
  const match = output.match(
    /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/[^\s]*)?/i,
  );
  return match?.[0].replace(/[),.;]+$/, "").replace("0.0.0.0", "127.0.0.1");
}

export function normalizedPreviewUrl(value: string): string {
  const normalized = /^[a-z][a-z\d+.-]*:\/\//i.test(value.trim())
    ? value.trim()
    : `http://${value.trim()}`;
  const url = new URL(normalized);
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("Preview URLs must use HTTP or HTTPS.");
  return url.toString();
}

export function openExternalPreview(value: string): void {
  const url = normalizedPreviewUrl(value);
  const [command, arguments_] =
    process.platform === "win32"
      ? ["rundll32.exe", ["url.dll,FileProtocolHandler", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  const child = spawn(command, arguments_, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.once("error", () => undefined);
  child.unref();
}

export async function readWorkingTreeDiff(
  workspaceRoot: string,
  path: string,
): Promise<string> {
  const { stdout } = await execFile(
    "git",
    ["diff", "--no-ext-diff", "--", path],
    { cwd: workspaceRoot, maxBuffer: 1_000_000 },
  );
  return stdout;
}

export async function stopProcessTree(child: ChildProcess): Promise<void> {
  if (process.platform === "win32" && child.pid) {
    try {
      await execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
      return;
    } catch {
      // Fall back to the Node process handle if taskkill is unavailable.
    }
  }
  child.kill();
}
