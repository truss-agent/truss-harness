import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configurationPaths, resolveConfiguration } from "./config.js";
import {
  keychainStore,
  libsecretStore,
  type RunCommand,
  type SecretStore,
  systemSecretStore,
} from "./secrets.js";
import {
  pickModel,
  runSetup,
  type SetupDependencies,
  type SetupIO,
} from "./setup.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function scripted(answers: string[]): SetupIO & {
  readonly output: () => string;
  readonly secretsAsked: string[];
} {
  let output = "";
  const secretsAsked: string[] = [];
  const next = (prompt: string) => {
    output += prompt;
    const answer = answers.shift();
    if (answer === undefined) throw new Error(`Unexpected prompt: ${prompt}`);
    return answer;
  };
  return {
    write: (text) => {
      output += text;
    },
    ask: async (label, fallback) => next(`${label}: `) || fallback || "",
    askSecret: async (label) => {
      secretsAsked.push(label);
      return next(`${label}: `);
    },
    output: () => output,
    secretsAsked,
  };
}

function memoryStore(): SecretStore & { readonly saved: Map<string, string> } {
  const saved = new Map<string, string>();
  return {
    label: "the test keyring",
    saved,
    get: async (account) => saved.get(account),
    set: async (account, secret) => {
      saved.set(account, secret);
    },
  };
}

function dependencies(
  overrides: Partial<SetupDependencies> = {},
): SetupDependencies & { readonly saved: Record<string, unknown> } {
  const saved: Record<string, unknown> = {};
  return {
    environment: {},
    detectLocalEndpoints: async () => [],
    listLocalModels: async () => [],
    discoverCloudModels: async () => [
      { id: "claude-sonnet-test" },
      { id: "claude-haiku-test" },
    ],
    saveProfile: async (name, profile) => {
      saved[name] = profile;
      return "/config.json";
    },
    saved,
    ...overrides,
  };
}

describe("guided setup", () => {
  it("connects a cloud provider, lists its models and stores the key", async () => {
    const secrets = memoryStore();
    const discover = vi.fn<SetupDependencies["discoverCloudModels"]>(
      async () => [{ id: "claude-sonnet-test" }, { id: "claude-haiku-test" }],
    );
    const deps = dependencies({ secrets, discoverCloudModels: discover });
    // Cloud, Anthropic (2nd in the catalog), key, model 2, default mode and approval.
    const io = scripted(["1", "2", "sk-ant-test", "2", "", ""]);
    const name = await runSetup(io, deps);
    expect(name).toBe("anthropic");
    expect(discover.mock.calls[0]?.[0].id).toBe("anthropic");
    expect(discover.mock.calls[0]?.[2]).toBe("sk-ant-test");
    expect(deps.saved.anthropic).toMatchObject({
      provider: "anthropic",
      model: "claude-haiku-test",
      credentialRef: "anthropic",
      mode: "edit",
      permission: "auto-read",
    });
    expect(secrets.saved.get("anthropic")).toBe("sk-ant-test");
    expect(JSON.stringify(deps.saved)).not.toContain("sk-ant-test");
    expect(io.output()).toContain("Saved the key in the test keyring.");
  });

  it("reuses a key from the environment without asking for it", async () => {
    const secrets = memoryStore();
    const deps = dependencies({
      secrets,
      environment: { ANTHROPIC_API_KEY: "sk-ant-env" },
    });
    const io = scripted(["1", "2", "", "1", "", ""]);
    await runSetup(io, deps);
    expect(io.secretsAsked).toEqual([]);
    expect(secrets.saved.size).toBe(0);
  });

  it("explains the environment variable when no keyring is available", async () => {
    const io = scripted(["1", "2", "sk-ant-test", "1", "", ""]);
    await runSetup(io, dependencies());
    expect(io.output()).toContain("export ANTHROPIC_API_KEY=<your key>");
  });

  it("stops on a rejected key before saving anything", async () => {
    const deps = dependencies({
      discoverCloudModels: async () => {
        throw new Error("Anthropic model discovery failed (401).");
      },
    });
    await expect(runSetup(scripted(["1", "2", "bad"]), deps)).rejects.toThrow(
      /401.*setup again/,
    );
    expect(deps.saved).toEqual({});
  });

  it("defaults to a detected local server and its models", async () => {
    const deps = dependencies({
      detectLocalEndpoints: async () => [
        {
          id: "ollama",
          label: "Ollama",
          kind: "ollama",
          baseUrl: "http://127.0.0.1:11434",
        },
      ],
      listLocalModels: async () => [{ name: "qwen-coder" }],
    });
    await runSetup(scripted(["", "", "", "", ""]), deps);
    expect(deps.saved.ollama).toMatchObject({
      provider: "ollama",
      model: "qwen-coder",
    });
  });

  it("filters long model lists by typed text", async () => {
    const ids = Array.from(
      { length: 40 },
      (_, index) => `vendor/model-${index}`,
    );
    const io = scripted(["model-3", "2"]);
    // "model-3" matches model-3 and model-30..39; the 2nd is model-30.
    expect(await pickModel(io, ids)).toBe("vendor/model-30");
    expect(io.output()).toContain("25 more");
  });
});

describe("system keyring", () => {
  it("passes the key to secret-tool on standard input only", async () => {
    const run = vi.fn<RunCommand>(async () => ({ code: 0, stdout: "" }));
    await libsecretStore(run).set("anthropic", "sk-ant-test");
    const [file, args, input] = run.mock.calls[0] ?? [];
    expect(file).toBe("secret-tool");
    expect(args?.join(" ")).not.toContain("sk-ant-test");
    expect(input).toBe("sk-ant-test");
  });

  it("reads keys back and treats a missing tool as no key", async () => {
    const found = libsecretStore(async () => ({ code: 0, stdout: "key\n" }));
    expect(await found.get("anthropic")).toBe("key");
    const missing = libsecretStore(async () => {
      throw Object.assign(new Error("spawn secret-tool ENOENT"), {
        code: "ENOENT",
      });
    });
    expect(await missing.get("anthropic")).toBeUndefined();
  });

  it("keeps the macOS key out of argv and rejects unsafe values", async () => {
    const run = vi.fn<RunCommand>(async () => ({ code: 0, stdout: "" }));
    await keychainStore(run).set("openai", "sk-test");
    expect(run.mock.calls[0]?.[1]).toEqual(["-i"]);
    expect(run.mock.calls[0]?.[2]).toContain('-w "sk-test"');
    await expect(
      keychainStore(run).set("openai", 'bad" ; rm'),
    ).rejects.toThrow();
    await expect(libsecretStore(run).set("../x", "k")).rejects.toThrow();
  });

  it("has no store on unsupported platforms", () => {
    expect(systemSecretStore("win32")).toBeUndefined();
    expect(systemSecretStore("linux")?.label).toBe("the system keyring");
  });
});

describe("configuration with a keyring", () => {
  it("uses a stored key after environment variables", async () => {
    const root = await mkdtemp(join(tmpdir(), "truss-setup-"));
    roots.push(root);
    const paths = configurationPaths(root, { XDG_CONFIG_HOME: root });
    const { saveUserProfile } = await import("./config.js");
    await saveUserProfile(
      root,
      "anthropic",
      {
        provider: "anthropic",
        model: "claude-sonnet-test",
        credentialRef: "anthropic",
      },
      paths,
    );
    expect(await readFile(paths.user, "utf8")).not.toContain("sk-");
    const secrets = memoryStore();
    secrets.saved.set("anthropic", "sk-ant-keyring");
    const fromKeyring = await resolveConfiguration({
      workspaceRoot: root,
      environment: {},
      paths,
      secrets,
    });
    expect(fromKeyring.apiKey).toBe("sk-ant-keyring");
    const fromEnvironment = await resolveConfiguration({
      workspaceRoot: root,
      environment: { ANTHROPIC_API_KEY: "sk-ant-env" },
      paths,
      secrets,
    });
    expect(fromEnvironment.apiKey).toBe("sk-ant-env");
  });
});
