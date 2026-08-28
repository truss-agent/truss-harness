import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, relative, resolve } from "node:path";

export interface RuntimeHostManifest {
  readonly schemaVersion: 1;
  readonly runtime: {
    readonly packageName: "@truss-harness/runtime";
    readonly version: string;
    readonly protocolVersions: readonly number[];
  };
  readonly artifact: {
    readonly fileName: string;
    readonly sha256: string;
    readonly bytes: number;
  };
}

export interface RuntimeHostActivation {
  readonly manifest: RuntimeHostManifest;
  /** Path relative to the controlled runtime-host directory. */
  readonly artifactPath: string;
  readonly activatedAt: string;
}

const activationFileName = "active.json";
const previousActivationFileName = "previous.json";

export function runtimeHostStorePath(homeDirectory = homedir()): string {
  return resolve(homeDirectory, ".truss-harness", "runtime-host");
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function validSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function validRelativeArtifactPath(value: string): boolean {
  return (
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.split(/[\\/]/).includes("..") &&
    basename(value) === value
  );
}

/** Parses the intentionally small, JSON-only managed-runtime release manifest. */
export function parseRuntimeHostManifest(value: unknown): RuntimeHostManifest {
  const source = record(value);
  const runtime = record(source?.runtime);
  const artifact = record(source?.artifact);
  if (
    source?.schemaVersion !== 1 ||
    runtime?.packageName !== "@truss-harness/runtime" ||
    typeof runtime.version !== "string" ||
    !runtime.version.trim() ||
    !Array.isArray(runtime.protocolVersions) ||
    runtime.protocolVersions.length === 0 ||
    !runtime.protocolVersions.every(
      (version) => Number.isInteger(version) && version > 0,
    ) ||
    typeof artifact?.fileName !== "string" ||
    !validRelativeArtifactPath(artifact.fileName) ||
    !validSha256(artifact.sha256) ||
    typeof artifact.bytes !== "number" ||
    !Number.isSafeInteger(artifact.bytes) ||
    artifact.bytes < 1
  )
    throw new Error("The runtime-host manifest is invalid.");
  return {
    schemaVersion: 1,
    runtime: {
      packageName: "@truss-harness/runtime",
      version: runtime.version,
      protocolVersions: [...runtime.protocolVersions],
    },
    artifact: {
      fileName: artifact.fileName,
      sha256: artifact.sha256.toLowerCase(),
      bytes: artifact.bytes,
    },
  };
}

function controlledArtifactPath(
  directory: string,
  artifactPath: string,
): string {
  const root = resolve(directory);
  const candidate = resolve(root, artifactPath);
  const pathFromRoot = relative(root, candidate);
  if (
    !pathFromRoot ||
    pathFromRoot.startsWith("..") ||
    pathFromRoot.includes("/../") ||
    pathFromRoot.includes("\\..\\")
  )
    throw new Error("The runtime-host artifact must remain in its store.");
  return candidate;
}

export async function verifyRuntimeHostArtifact(
  directory: string,
  artifactPath: string,
  manifest: RuntimeHostManifest,
): Promise<void> {
  const path = controlledArtifactPath(directory, artifactPath);
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size !== manifest.artifact.bytes)
    throw new Error(
      "The runtime-host artifact size does not match its manifest.",
    );
  const digest = createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
  if (digest !== manifest.artifact.sha256)
    throw new Error(
      "The runtime-host artifact checksum does not match its manifest.",
    );
}

async function writeActivation(
  directory: string,
  fileName: string,
  value: RuntimeHostActivation,
): Promise<void> {
  const path = resolve(directory, fileName);
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

export async function readRuntimeHostActivation(
  directory: string,
  fileName = activationFileName,
): Promise<RuntimeHostActivation | undefined> {
  try {
    const value = JSON.parse(
      await readFile(resolve(directory, fileName), "utf8"),
    ) as unknown;
    const source = record(value);
    if (
      !source ||
      typeof source.artifactPath !== "string" ||
      !validRelativeArtifactPath(source.artifactPath) ||
      typeof source.activatedAt !== "string"
    )
      return undefined;
    return {
      manifest: parseRuntimeHostManifest(source.manifest),
      artifactPath: source.artifactPath,
      activatedAt: source.activatedAt,
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return undefined;
    return undefined;
  }
}

/**
 * Activates only an already-downloaded, verified artifact and preserves the
 * last known-good activation for an explicit rollback.
 */
export async function activateRuntimeHost(
  directory: string,
  artifactPath: string,
  manifest: RuntimeHostManifest,
  now: () => Date = () => new Date(),
): Promise<RuntimeHostActivation> {
  await mkdir(directory, { recursive: true });
  await verifyRuntimeHostArtifact(directory, artifactPath, manifest);
  const previous = await readRuntimeHostActivation(directory);
  if (previous)
    await writeActivation(directory, previousActivationFileName, previous);
  const activation: RuntimeHostActivation = {
    manifest,
    artifactPath,
    activatedAt: now().toISOString(),
  };
  await writeActivation(directory, activationFileName, activation);
  return activation;
}

/**
 * Copies a user-selected release asset into the controlled store, verifies it
 * there, and only then records it as active. Downloading remains outside this
 * API so network trust can be added separately from local activation.
 */
export async function installRuntimeHostArtifact(
  directory: string,
  sourcePath: string,
  manifest: RuntimeHostManifest,
): Promise<RuntimeHostActivation> {
  await mkdir(directory, { recursive: true });
  const targetPath = controlledArtifactPath(
    directory,
    manifest.artifact.fileName,
  );
  const stagingPath = `${targetPath}.${process.pid}.staging`;
  try {
    await copyFile(sourcePath, stagingPath);
    await verifyRuntimeHostArtifact(directory, basename(stagingPath), manifest);
    await rename(stagingPath, targetPath);
    return await activateRuntimeHost(
      directory,
      manifest.artifact.fileName,
      manifest,
    );
  } catch (error) {
    await rm(stagingPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function rollbackRuntimeHost(
  directory: string,
): Promise<RuntimeHostActivation | undefined> {
  const previous = await readRuntimeHostActivation(
    directory,
    previousActivationFileName,
  );
  if (!previous) return undefined;
  await verifyRuntimeHostArtifact(
    directory,
    previous.artifactPath,
    previous.manifest,
  );
  const current = await readRuntimeHostActivation(directory);
  if (current)
    await writeActivation(directory, previousActivationFileName, current);
  await writeActivation(directory, activationFileName, previous);
  return previous;
}
