import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  activateRuntimeHost,
  type RuntimeHostManifest,
} from "@truss-harness/cli/protocol";
import { resolveRuntimeHostLaunch } from "./runtime-host-resolution.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("resolveRuntimeHostLaunch", () => {
  it("prioritizes an explicitly configured local CLI", async () => {
    await expect(
      resolveRuntimeHostLaunch({
        configuredCommand: "/usr/local/bin/truss-cli",
        extensionMode: "production",
        extensionPath: "/extension",
        globalStoragePath: "/storage",
        onDiagnostic: () => undefined,
      }),
    ).resolves.toMatchObject({
      source: "configured",
      command: "/usr/local/bin/truss-cli",
    });
  });

  it("selects only a verified activated runtime host", async () => {
    const storage = await mkdtemp(join(tmpdir(), "truss-vscode-runtime-"));
    directories.push(storage);
    const store = join(storage, "runtime-host");
    await mkdir(store);
    const fileName = "truss-runtime-host.cjs";
    const contents = "console.log('runtime host');";
    await writeFile(join(store, fileName), contents, "utf8");
    const manifest: RuntimeHostManifest = {
      schemaVersion: 1,
      runtime: {
        packageName: "@truss-harness/runtime",
        version: "0.1.11",
        protocolVersions: [1],
      },
      artifact: {
        fileName,
        sha256: createHash("sha256").update(contents).digest("hex"),
        bytes: Buffer.byteLength(contents),
      },
    };
    await activateRuntimeHost(store, fileName, manifest);
    await expect(
      resolveRuntimeHostLaunch({
        configuredCommand: "",
        extensionMode: "production",
        extensionPath: "/extension",
        globalStoragePath: storage,
        onDiagnostic: () => undefined,
      }),
    ).resolves.toMatchObject({
      source: "managed",
      arguments: [join(store, fileName)],
    });
  });

  it("falls back to the bundled service when activation is invalid", async () => {
    const storage = await mkdtemp(join(tmpdir(), "truss-vscode-runtime-"));
    directories.push(storage);
    const store = join(storage, "runtime-host");
    await mkdir(store);
    const fileName = "truss-runtime-host.cjs";
    await writeFile(join(store, fileName), "valid", "utf8");
    const manifest: RuntimeHostManifest = {
      schemaVersion: 1,
      runtime: {
        packageName: "@truss-harness/runtime",
        version: "0.1.11",
        protocolVersions: [1],
      },
      artifact: { fileName, sha256: "a".repeat(64), bytes: 5 },
    };
    await writeFile(
      join(store, "active.json"),
      JSON.stringify({
        manifest,
        artifactPath: fileName,
        activatedAt: "2026-08-27T00:00:00.000Z",
      }),
      "utf8",
    );
    const diagnostics: string[] = [];
    await expect(
      resolveRuntimeHostLaunch({
        configuredCommand: "",
        extensionMode: "production",
        extensionPath: "/extension",
        globalStoragePath: storage,
        onDiagnostic: (message) => diagnostics.push(message),
      }),
    ).resolves.toMatchObject({ source: "bundled" });
    expect(diagnostics).toHaveLength(1);
  });
});
