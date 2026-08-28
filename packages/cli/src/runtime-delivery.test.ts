import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  activateRuntimeHost,
  installRuntimeHostArtifact,
  parseRuntimeHostManifest,
  readRuntimeHostActivation,
  rollbackRuntimeHost,
  verifyRuntimeHostArtifact,
  type RuntimeHostManifest,
} from "./runtime-delivery.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture(content: string): Promise<{
  readonly directory: string;
  readonly manifest: RuntimeHostManifest;
}> {
  const directory = await mkdtemp(join(tmpdir(), "truss-runtime-host-"));
  directories.push(directory);
  const fileName = "truss-runtime-host.cjs";
  await writeFile(join(directory, fileName), content, "utf8");
  return {
    directory,
    manifest: {
      schemaVersion: 1,
      runtime: {
        packageName: "@truss-harness/runtime",
        version: "0.1.11",
        protocolVersions: [1],
      },
      artifact: {
        fileName,
        sha256: createHash("sha256").update(content).digest("hex"),
        bytes: Buffer.byteLength(content),
      },
    },
  };
}

describe("runtime-host delivery", () => {
  it("validates a small release manifest", () => {
    expect(
      parseRuntimeHostManifest({
        schemaVersion: 1,
        runtime: {
          packageName: "@truss-harness/runtime",
          version: "0.1.11",
          protocolVersions: [1],
        },
        artifact: {
          fileName: "truss-runtime-host.cjs",
          sha256: "a".repeat(64),
          bytes: 12,
        },
      }),
    ).toMatchObject({ schemaVersion: 1 });
    expect(() =>
      parseRuntimeHostManifest({
        schemaVersion: 1,
        runtime: {
          packageName: "@truss-harness/runtime",
          version: "0.1.11",
          protocolVersions: [1],
        },
        artifact: {
          fileName: "../host.cjs",
          sha256: "a".repeat(64),
          bytes: 12,
        },
      }),
    ).toThrow("invalid");
  });

  it("activates a verified artifact and restores the last known-good one", async () => {
    const first = await fixture("first host");
    await activateRuntimeHost(
      first.directory,
      first.manifest.artifact.fileName,
      first.manifest,
      () => new Date("2026-08-27T00:00:00.000Z"),
    );
    const secondContent = "second host";
    const secondName = "truss-runtime-host-next.cjs";
    await writeFile(join(first.directory, secondName), secondContent, "utf8");
    const second: RuntimeHostManifest = {
      ...first.manifest,
      runtime: { ...first.manifest.runtime, version: "0.1.12" },
      artifact: {
        fileName: secondName,
        sha256: createHash("sha256").update(secondContent).digest("hex"),
        bytes: Buffer.byteLength(secondContent),
      },
    };
    await activateRuntimeHost(first.directory, secondName, second);
    expect(
      (await rollbackRuntimeHost(first.directory))?.manifest.runtime.version,
    ).toBe("0.1.11");
    expect(
      (await readRuntimeHostActivation(first.directory))?.artifactPath,
    ).toBe(first.manifest.artifact.fileName);
  });

  it("rejects a changed artifact before activation", async () => {
    const { directory, manifest } = await fixture("known-good");
    await writeFile(
      join(directory, manifest.artifact.fileName),
      "tampered",
      "utf8",
    );
    await expect(
      verifyRuntimeHostArtifact(
        directory,
        manifest.artifact.fileName,
        manifest,
      ),
    ).rejects.toThrow("size");
  });

  it("installs a user-selected artifact only after verification", async () => {
    const { directory, manifest } = await fixture("known-good");
    const source = join(directory, "downloaded-host.cjs");
    await writeFile(source, "known-good", "utf8");
    const activation = await installRuntimeHostArtifact(
      directory,
      source,
      manifest,
    );
    expect(activation.artifactPath).toBe(manifest.artifact.fileName);
  });
});
