import { execFile } from "node:child_process";

export type AgentState = "idle" | "working" | "blocked";

/**
 * Tells a terminal workspace manager what the chat is doing. Reports are
 * best-effort: they never block the chat and failures are ignored.
 */
export interface AgentStatusReporter {
  state(state: AgentState, message?: string): void;
  /** The command that reopens this conversation after a restart. */
  resumeCommand(
    conversationId: string | undefined,
    argv: readonly string[],
  ): void;
  /** The user quit; clears the agent from the pane. */
  release(): Promise<void>;
}

export const silentAgentStatus: AgentStatusReporter = {
  state() {},
  resumeCommand() {},
  release: async () => {},
};

/** Runs a program without a shell, resolving once it exits or times out. */
export type RunReport = (
  file: string,
  args: readonly string[],
) => Promise<void>;

const reportTimeoutMilliseconds = 2_000;
const source = "truss-cli";
const agent = "truss";

const runReport: RunReport = (file, args) =>
  new Promise((resolve) => {
    execFile(
      file,
      [...args],
      { timeout: reportTimeoutMilliseconds, windowsHide: true },
      () => resolve(),
    );
  });

/** Herdr refuses resume commands with apostrophes or control characters. */
function resumable(argv: readonly string[]): boolean {
  return (
    argv.length > 0 &&
    argv.length <= 64 &&
    // biome-ignore lint/suspicious/noControlCharactersInRegex: herdr rejects control characters
    argv.every((argument) => !/['\x00-\x1f\x7f]/.test(argument)) &&
    argv.join(" ").length <= 8_192
  );
}

/**
 * Reports to Herdr (https://herdr.dev) through `$HERDR_BIN_PATH pane
 * report-agent`, following its "Add Herdr support to your agent" guide.
 * Returns undefined outside a Herdr pane.
 */
export function herdrAgentStatus(
  environment: NodeJS.ProcessEnv = process.env,
  run: RunReport = runReport,
  now: () => number = Date.now,
): AgentStatusReporter | undefined {
  const binary = environment.HERDR_BIN_PATH;
  const pane = environment.HERDR_PANE_ID;
  if (environment.HERDR_ENV !== "1" || !binary || !pane) return undefined;
  let sequence = 0;
  // Herdr drops reports whose number is not higher than the last; a clock
  // keeps that true across restarts of the CLI.
  const next = () => {
    sequence = Math.max(sequence + 1, now());
    return String(sequence);
  };
  let current: { state: AgentState; message?: string } = { state: "idle" };
  let resume: { id?: string; argv: readonly string[] } | undefined;
  let inFlight: Promise<void> | undefined;
  let dirty = false;
  let released = false;
  const send = () => {
    dirty = true;
    if (inFlight || released) return;
    // Only the latest state is sent; changes made while one report is in
    // flight collapse into the next.
    inFlight = (async () => {
      while (dirty && !released) {
        dirty = false;
        const args = [
          "pane",
          "report-agent",
          pane,
          "--source",
          source,
          "--agent",
          agent,
          "--state",
          current.state,
          "--seq",
          next(),
          ...(current.message ? ["--message", current.message] : []),
          ...(resume?.id ? ["--agent-session-id", resume.id] : []),
          ...(resume ? ["--", ...resume.argv] : []),
        ];
        await run(binary, args).catch(() => undefined);
      }
      inFlight = undefined;
    })();
  };
  return {
    state(state, message) {
      if (current.state === state && current.message === message) return;
      current = message ? { state, message } : { state };
      send();
    },
    resumeCommand(id, argv) {
      if (!resumable(argv)) return;
      resume = id ? { id, argv } : { argv };
      send();
    },
    async release() {
      if (released) return;
      released = true;
      await inFlight;
      await run(binary, [
        "pane",
        "release-agent",
        pane,
        "--source",
        source,
        "--agent",
        agent,
        "--seq",
        next(),
      ]).catch(() => undefined);
    },
  };
}
