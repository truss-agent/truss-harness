import { spawn } from "node:child_process";

/** Stores provider API keys outside configuration files. */
export interface SecretStore {
  /** Human-readable name shown when a key is saved, such as "GNOME Keyring". */
  readonly label: string;
  get(account: string): Promise<string | undefined>;
  set(account: string, secret: string): Promise<void>;
}

export interface CommandResult {
  readonly code: number;
  readonly stdout: string;
}

/** Runs a program without a shell; `input` is written to standard input. */
export type RunCommand = (
  file: string,
  args: readonly string[],
  input?: string,
) => Promise<CommandResult>;

const service = "truss-harness";
const timeoutMilliseconds = 60_000;

export const runCommand: RunCommand = (file, args, input) =>
  new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ["pipe", "pipe", "ignore"] });
    let stdout = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${file} did not respond.`));
    }, timeoutMilliseconds);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout });
    });
    child.stdin.end(input ?? "");
  });

function checkedAccount(account: string): string {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(account))
    throw new Error(
      "Credential account names use letters, digits, '.', '_' or '-'.",
    );
  return account;
}

function checkedSecret(secret: string): string {
  const value = secret.trim();
  // Keys are printable tokens; quotes and backslashes would need escaping below.
  if (!value || !/^[\x21-\x7e]+$/.test(value) || /["\\]/.test(value))
    throw new Error("That does not look like an API key.");
  return value;
}

/** libsecret through `secret-tool`; the key travels over standard input. */
export function libsecretStore(run: RunCommand = runCommand): SecretStore {
  return {
    label: "the system keyring",
    async get(account) {
      try {
        const result = await run("secret-tool", [
          "lookup",
          "service",
          service,
          "account",
          checkedAccount(account),
        ]);
        return result.code === 0
          ? result.stdout.trim() || undefined
          : undefined;
      } catch {
        return undefined;
      }
    },
    async set(account, secret) {
      const result = await run(
        "secret-tool",
        [
          "store",
          `--label=Truss API key (${checkedAccount(account)})`,
          "service",
          service,
          "account",
          account,
        ],
        checkedSecret(secret),
      );
      if (result.code !== 0)
        throw new Error("The system keyring did not accept the key.");
    },
  };
}

/** macOS Keychain through `security -i`, so the key never appears in argv. */
export function keychainStore(run: RunCommand = runCommand): SecretStore {
  return {
    label: "the macOS Keychain",
    async get(account) {
      try {
        const result = await run("security", [
          "find-generic-password",
          "-s",
          service,
          "-a",
          checkedAccount(account),
          "-w",
        ]);
        return result.code === 0
          ? result.stdout.trim() || undefined
          : undefined;
      } catch {
        return undefined;
      }
    },
    async set(account, secret) {
      const result = await run(
        "security",
        ["-i"],
        `add-generic-password -U -s ${service} -a ${checkedAccount(account)} -w "${checkedSecret(secret)}"\n`,
      );
      if (result.code !== 0)
        throw new Error("The macOS Keychain did not accept the key.");
    },
  };
}

/** The keyring for this platform, or undefined where none is supported. */
export function systemSecretStore(
  platform: NodeJS.Platform = process.platform,
  run: RunCommand = runCommand,
): SecretStore | undefined {
  if (platform === "darwin") return keychainStore(run);
  if (platform === "linux" || platform === "freebsd" || platform === "openbsd")
    return libsecretStore(run);
  return undefined;
}
