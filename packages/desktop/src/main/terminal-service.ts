import { type ChildProcess, spawn } from "node:child_process";
import type { DesktopEvent } from "../shared.js";

export class TerminalService {
  private readonly processes = new Set<ChildProcess>();

  constructor(
    private readonly workspaceRoot: () => string,
    private readonly send: (event: DesktopEvent) => void,
    private readonly executeWorkspaceCommand: (input: {
      readonly workspaceRoot: string;
      readonly input: string;
    }) => Promise<{ readonly ok: boolean; readonly message: string }>,
  ) {}

  async run(command: string): Promise<string> {
    const commandId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const normalized = typeof command === "string" ? command.trim() : "";
    if (!normalized) throw new Error("Enter a terminal command.");
    if (normalized.length > 20_000)
      throw new Error("The terminal command is too long.");
    if (normalized.startsWith("/")) {
      try {
        const result = await this.executeWorkspaceCommand({
          workspaceRoot: this.workspaceRoot(),
          input: normalized,
        });
        this.send({
          type: "terminal-output",
          commandId,
          text: `${result.message}\n\n[workspace command ${result.ok ? "completed" : "failed"}]\n`,
        });
      } catch (error) {
        this.send({
          type: "terminal-output",
          commandId,
          text: `[workspace command failed] ${error instanceof Error ? error.message : String(error)}\n`,
        });
      }
      return commandId;
    }
    const child = spawn(normalized, {
      cwd: this.workspaceRoot(),
      shell: true,
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    this.processes.add(child);
    child.stdout.on("data", (data: Buffer) =>
      this.send({ type: "terminal-output", commandId, text: data.toString() }),
    );
    child.stderr.on("data", (data: Buffer) =>
      this.send({ type: "terminal-output", commandId, text: data.toString() }),
    );
    child.on("error", (error) =>
      this.send({
        type: "terminal-output",
        commandId,
        text: `\n[terminal error] ${error.message}\n`,
      }),
    );
    child.on("close", (code) => {
      this.processes.delete(child);
      this.send({
        type: "terminal-output",
        commandId,
        text: `\n[process exited: ${code ?? "unknown"}]\n`,
      });
    });
    return commandId;
  }

  stopAll(): number {
    let stopped = 0;
    for (const child of this.processes)
      if (stopProcessTree(child)) stopped += 1;
    this.processes.clear();
    return stopped;
  }
}

export function stopProcessTree(child: ChildProcess | undefined): boolean {
  if (!child || child.killed || child.exitCode !== null) return false;
  if (process.platform === "win32" && child.pid) {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
    });
    killer.on("error", () => child.kill());
    return true;
  }
  if (child.pid) {
    try {
      process.kill(-child.pid, "SIGTERM");
      return true;
    } catch {
      // A process can exit between inspection and the signal.
    }
  }
  child.kill("SIGTERM");
  return true;
}
