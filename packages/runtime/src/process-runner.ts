import { execFile, spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import {
  byteLimit,
  defaultToolOutputBytes,
  truncateUtf8,
} from "./resource-limits.js";

export interface ProcessRunRequest {
  readonly command: string;
  readonly cwd: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs: number;
  readonly maxOutputBytes?: number;
  readonly drainTimeoutMs?: number;
}
export interface ProcessRunResult {
  readonly output: string;
  readonly exitCode: number | null;
  readonly outcome:
    | "exited"
    | "timeout"
    | "aborted"
    | "drain_timeout"
    | "error";
  readonly truncated: boolean;
}
export interface ProcessRunner {
  run(request: ProcessRunRequest): Promise<ProcessRunResult>;
}
export interface ProcessTreeTerminator {
  terminate(pid: number, force: boolean): Promise<void>;
}

export interface ProcessCommandExecutor {
  execute(
    file: string,
    args: readonly string[],
    options: { readonly timeoutMs: number; readonly maxOutputBytes: number },
  ): Promise<void>;
}

class NodeProcessCommandExecutor implements ProcessCommandExecutor {
  async execute(
    file: string,
    args: readonly string[],
    options: { readonly timeoutMs: number; readonly maxOutputBytes: number },
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      execFile(
        file,
        [...args],
        {
          windowsHide: true,
          timeout: options.timeoutMs,
          maxBuffer: options.maxOutputBytes,
        },
        (error) => (error ? reject(error) : resolve()),
      );
    });
  }
}

/** POSIX process groups; Windows taskkill /T /F. Escaped sessions and native job containment require a stronger injected adapter. */
export class NodeProcessTreeTerminator implements ProcessTreeTerminator {
  constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly commands: ProcessCommandExecutor = new NodeProcessCommandExecutor(),
  ) {}
  async terminate(pid: number, force: boolean): Promise<void> {
    if (this.platform === "win32") {
      await this.commands.execute(
        "taskkill",
        ["/PID", String(pid), "/T", "/F"],
        { timeoutMs: 200, maxOutputBytes: 1024 },
      );
    } else {
      try {
        process.kill(-pid, force ? "SIGKILL" : "SIGTERM");
      } catch (error) {
        if (
          !(
            error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "ESRCH"
          )
        )
          throw error;
      }
    }
  }
}

export class NodeProcessRunner implements ProcessRunner {
  constructor(
    private readonly tree: ProcessTreeTerminator = new NodeProcessTreeTerminator(),
  ) {}
  async run(request: ProcessRunRequest): Promise<ProcessRunResult> {
    const maximum = byteLimit(request.maxOutputBytes ?? defaultToolOutputBytes);
    const drain = byteLimit(request.drainTimeoutMs ?? 250);
    if (!Number.isFinite(request.timeoutMs) || request.timeoutMs <= 0)
      throw new Error("Invalid process timeout.");
    if (request.signal?.aborted)
      return {
        output: "",
        exitCode: null,
        outcome: "aborted",
        truncated: false,
      };
    return new Promise((resolve) => {
      const child = spawn(request.command, {
        cwd: request.cwd,
        shell: true,
        windowsHide: true,
        detached: process.platform !== "win32",
      });
      const chunks: Buffer[] = [];
      let bytes = 0;
      let truncated = false;
      let code: number | null = null;
      let outcome: ProcessRunResult["outcome"] = "exited";
      let settled = false;
      let stopping = false;
      let closeSeen = false;
      let drainTimer: ReturnType<typeof setTimeout> | undefined;
      let escalation: ReturnType<typeof setTimeout> | undefined;
      const capture = (data: Buffer) => {
        const available = maximum - bytes;
        if (data.length > available) truncated = true;
        if (available > 0) {
          chunks.push(Buffer.from(data.subarray(0, available)));
          bytes += Math.min(available, data.length);
        }
      };
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(drainTimer);
        clearTimeout(escalation);
        request.signal?.removeEventListener("abort", abort);
        child.stdout.destroy();
        child.stderr.destroy();
        const text = new StringDecoder("utf8").write(
          Buffer.concat(chunks, bytes),
        );
        resolve({
          output: truncateUtf8(text, maximum, truncated),
          exitCode: code,
          outcome,
          truncated,
        });
      };
      const terminate = (force: boolean) =>
        child.pid
          ? this.tree.terminate(child.pid, force).catch(() => {
              outcome = "error";
            })
          : Promise.resolve();
      const stop = (reason: ProcessRunResult["outcome"]) => {
        if (settled || stopping) return;
        stopping = true;
        outcome = reason;
        clearTimeout(drainTimer);
        void terminate(false);
        // Escalate even if the shell closes first: descendants may ignore SIGTERM.
        escalation = setTimeout(
          () => {
            void terminate(true).finally(() => {
              if (closeSeen) finish();
            });
          },
          Math.min(100, Math.floor(drain / 2)),
        );
        drainTimer = setTimeout(() => {
          void terminate(true);
          finish();
        }, drain);
      };
      const abort = () => stop("aborted");
      const timer = setTimeout(() => stop("timeout"), request.timeoutMs);
      request.signal?.addEventListener("abort", abort, { once: true });
      if (request.signal?.aborted) abort();
      child.stdout.on("data", capture);
      child.stderr.on("data", capture);
      child.once("exit", (exit) => {
        code = exit;
        if (!stopping)
          drainTimer = setTimeout(() => stop("drain_timeout"), drain);
      });
      child.once("close", (exit) => {
        code = exit;
        closeSeen = true;
        if (!stopping) finish();
      });
      child.once("error", (error) => {
        capture(Buffer.from(error.message));
        stop("error");
      });
    });
  }
}
