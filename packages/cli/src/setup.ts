import { createInterface } from "node:readline/promises";
import { brand } from "@truss-harness/branding";
import {
  type CloudModelInfo,
  type CloudProviderDefinition,
  cloudProviderDefinitions,
  type LocalModelEndpoint,
} from "@truss-harness/provider-openai-compatible";
import {
  type ProfileConfiguration,
  providerAccountEnvironmentVariable,
} from "./config.js";
import type { SecretStore } from "./secrets.js";

export interface SetupIO {
  write(text: string): void;
  /** Returns the trimmed answer, or `fallback` for an empty one. */
  ask(label: string, fallback?: string): Promise<string>;
  /** Reads a line without echoing it. */
  askSecret(label: string): Promise<string>;
}

export interface SetupDependencies {
  readonly environment: NodeJS.ProcessEnv;
  readonly secrets?: SecretStore;
  detectLocalEndpoints(): Promise<readonly LocalModelEndpoint[]>;
  listLocalModels(
    endpoint: LocalModelEndpoint,
  ): Promise<readonly { readonly name: string }[]>;
  discoverCloudModels(
    definition: CloudProviderDefinition,
    baseUrl: string,
    credential: string,
  ): Promise<readonly CloudModelInfo[]>;
  saveProfile(name: string, profile: ProfileConfiguration): Promise<string>;
}

export class SetupCancelledError extends Error {
  constructor() {
    super("Setup cancelled.");
    this.name = "SetupCancelledError";
  }
}

const shownModels = 15;

async function choose(
  io: SetupIO,
  label: string,
  count: number,
  fallback: number,
): Promise<number> {
  for (;;) {
    const answer = await io.ask(label, String(fallback));
    const index = Number.parseInt(answer, 10);
    if (String(index) === answer && index >= 1 && index <= count)
      return index - 1;
    io.write(`Enter a number from 1 to ${count}.\n`);
  }
}

/** Numbered model list with filtering, for providers that list hundreds. */
export async function pickModel(
  io: SetupIO,
  ids: readonly string[],
): Promise<string> {
  if (!ids.length) {
    for (;;) {
      const typed = await io.ask("Model ID");
      if (typed) return typed;
    }
  }
  let shown = ids;
  for (;;) {
    shown.slice(0, shownModels).forEach((id, index) => {
      io.write(`${String(index + 1).padStart(3)}. ${id}\n`);
    });
    if (shown.length > shownModels)
      io.write(
        `     … ${shown.length - shownModels} more. Type part of a name to narrow the list.\n`,
      );
    const answer = await io.ask("Model (number, name, or filter)", "1");
    const index = Number.parseInt(answer, 10);
    if (
      String(index) === answer &&
      index >= 1 &&
      index <= Math.min(shown.length, shownModels)
    )
      return shown[index - 1] as string;
    if (ids.includes(answer)) return answer;
    const filtered = ids.filter((id) =>
      id.toLowerCase().includes(answer.toLowerCase()),
    );
    if (filtered.length === 1) return filtered[0] as string;
    if (!filtered.length) {
      io.write(`No models match "${answer}".\n`);
      shown = ids;
    } else shown = filtered;
  }
}

async function chooseDefaults(io: SetupIO): Promise<{
  readonly mode: "chat" | "plan" | "edit";
  readonly permission: "ask" | "auto-read" | "auto-all";
}> {
  let mode: string;
  do mode = await io.ask("Default mode: chat, plan, or edit", "edit");
  while (mode !== "chat" && mode !== "plan" && mode !== "edit");
  let permission: string;
  do
    permission = await io.ask(
      "Tool approval: ask, auto-read, or auto-all",
      "auto-read",
    );
  while (
    permission !== "ask" &&
    permission !== "auto-read" &&
    permission !== "auto-all"
  );
  return { mode, permission };
}

async function cloudSetup(
  io: SetupIO,
  dependencies: SetupDependencies,
): Promise<{ readonly name: string; readonly profile: ProfileConfiguration }> {
  io.write("\n");
  cloudProviderDefinitions.forEach((provider, index) => {
    io.write(`${String(index + 1).padStart(3)}. ${provider.label}\n`);
  });
  const definition = cloudProviderDefinitions[
    await choose(io, "Provider", cloudProviderDefinitions.length, 1)
  ] as CloudProviderDefinition;
  const { environment, secrets } = dependencies;
  const fromEnvironment =
    environment[providerAccountEnvironmentVariable(definition.id)] ??
    environment[definition.apiKeyEnvironmentVariable];
  const saved = fromEnvironment ?? (await secrets?.get(definition.id));
  let key: string | undefined;
  if (saved) {
    const reuse = await io.ask(
      `Use the ${definition.label} key already ${fromEnvironment ? "in your environment" : `in ${secrets?.label}`}? yes or no`,
      "yes",
    );
    if (/^(y|yes)$/i.test(reuse)) key = saved;
  }
  const entered = !key;
  while (!key) {
    key = (await io.askSecret(`${definition.label} API key`)).trim();
    if (!key) io.write("An API key is required for a cloud provider.\n");
  }
  io.write(`Loading ${definition.label} models…\n`);
  let models: readonly CloudModelInfo[];
  try {
    models = await dependencies.discoverCloudModels(
      definition,
      definition.baseUrl,
      key,
    );
  } catch (error) {
    // Discovery doubles as the key check; a typo should fail here, not mid-chat.
    const reason = (
      error instanceof Error ? error.message : String(error)
    ).replace(/[.\s]*$/, ".");
    throw new Error(
      `${reason} Check the key and run ${brand.cliCommand} setup again.`,
    );
  }
  const model = await pickModel(
    io,
    models.map((info) => info.id),
  );
  if (entered) {
    let stored = false;
    if (secrets)
      try {
        await secrets.set(definition.id, key);
        io.write(`Saved the key in ${secrets.label}.\n`);
        stored = true;
      } catch (error) {
        io.write(
          `Could not save the key: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      }
    if (!stored)
      io.write(
        `Add this to your shell profile so ${brand.cliCommand} can use the key:\n  export ${definition.apiKeyEnvironmentVariable}=<your key>\n`,
      );
  }
  return {
    name: definition.id,
    profile: {
      provider: definition.id,
      baseUrl: definition.baseUrl,
      model,
      credentialRef: definition.id,
      ...(await chooseDefaults(io)),
    },
  };
}

async function localSetup(
  io: SetupIO,
  dependencies: SetupDependencies,
  endpoints: readonly LocalModelEndpoint[],
): Promise<{ readonly name: string; readonly profile: ProfileConfiguration }> {
  io.write("\n");
  endpoints.forEach((endpoint, index) => {
    io.write(
      `${String(index + 1).padStart(3)}. ${endpoint.label} (${endpoint.baseUrl})\n`,
    );
  });
  io.write(`${String(endpoints.length + 1).padStart(3)}. Custom endpoint\n`);
  const choice = await choose(io, "Server", endpoints.length + 1, 1);
  let endpoint = endpoints[choice];
  if (!endpoint) {
    let kind: string;
    do
      kind = await io.ask(
        "Server type: ollama or openai-compatible",
        "openai-compatible",
      );
    while (kind !== "ollama" && kind !== "openai-compatible");
    endpoint = {
      id: "local",
      label: "Custom endpoint",
      kind,
      baseUrl: await io.ask(
        "Endpoint URL",
        kind === "ollama"
          ? "http://127.0.0.1:11434"
          : "http://127.0.0.1:1234/v1",
      ),
    };
  }
  const models = await dependencies
    .listLocalModels(endpoint)
    .catch(() => [] as const);
  const model = await pickModel(
    io,
    models.map((info) => info.name),
  );
  return {
    name: endpoint.id,
    profile: {
      provider: endpoint.kind,
      baseUrl: endpoint.baseUrl,
      model,
      ...(await chooseDefaults(io)),
    },
  };
}

/** Guided setup; saves the chosen profile as the default and returns its name. */
export async function runSetup(
  io: SetupIO,
  dependencies: SetupDependencies,
): Promise<string> {
  io.write(
    `${brand.productName} setup. Press Enter to accept the value in brackets.\n\n`,
  );
  const endpoints = await dependencies.detectLocalEndpoints();
  io.write("  1. Cloud provider (API key)\n");
  io.write(
    `  2. Local model server${endpoints.length ? ` (found ${endpoints.map((endpoint) => endpoint.label).join(", ")})` : ""}\n`,
  );
  const local =
    (await choose(io, "Connect", 2, endpoints.length ? 2 : 1)) === 1;
  const { name, profile } = local
    ? await localSetup(io, dependencies, endpoints)
    : await cloudSetup(io, dependencies);
  const path = await dependencies.saveProfile(name, profile);
  io.write(
    `\nSaved profile '${name}' (${profile.provider} · ${profile.model}) as your default in ${path}.\n`,
  );
  return name;
}

/** Reads a line in raw mode, echoing '*' for each character. */
function readHidden(
  input: NodeJS.ReadStream,
  output: NodeJS.WriteStream,
  label: string,
): Promise<string> {
  output.write(`${label}: `);
  return new Promise((resolve, reject) => {
    let value = "";
    let inEscape = false;
    const finish = (error?: Error) => {
      input.removeListener("data", onData);
      input.setRawMode(false);
      input.pause();
      output.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: Buffer | string) => {
      for (const character of chunk.toString("utf8")) {
        if (inEscape) {
          // Skip escape sequences such as arrows and bracketed-paste markers.
          if (/[@-~]/.test(character) && character !== "[") inEscape = false;
          continue;
        }
        if (character === "\x1b") inEscape = true;
        else if (character === "\r" || character === "\n") return finish();
        else if (character === "\x03") return finish(new SetupCancelledError());
        else if (character === "\x7f" || character === "\b") {
          if (value) {
            value = value.slice(0, -1);
            output.write("\b \b");
          }
        } else if (character >= " ") {
          value += character;
          output.write("*");
        }
      }
    };
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

/** Terminal prompts; piped input is read line by line for scripted setup. */
export function terminalSetupIO(
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WriteStream = process.stdout,
): SetupIO & { close(): void } {
  const interactive = input.isTTY === true;
  const piped = interactive
    ? undefined
    : createInterface({ input, terminal: false });
  const lines = piped?.[Symbol.asyncIterator]();
  const readLine = async (prompt: string): Promise<string> => {
    output.write(prompt);
    if (lines) {
      const next = await lines.next();
      if (next.done) throw new SetupCancelledError();
      return next.value;
    }
    const readline = createInterface({ input, output, terminal: true });
    const controller = new AbortController();
    readline.once("SIGINT", () => controller.abort());
    try {
      return await readline.question("", { signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) {
        output.write("\n");
        throw new SetupCancelledError();
      }
      throw error;
    } finally {
      readline.close();
    }
  };
  return {
    write: (text) => output.write(text),
    async ask(label, fallback) {
      const answer = (
        await readLine(fallback ? `${label} [${fallback}]: ` : `${label}: `)
      ).trim();
      return answer || fallback || "";
    },
    askSecret: (label) =>
      interactive ? readHidden(input, output, label) : readLine(`${label}: `),
    close: () => piped?.close(),
  };
}
