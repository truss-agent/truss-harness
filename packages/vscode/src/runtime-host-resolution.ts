import { resolve } from "node:path";
import {
  readRuntimeHostActivation,
  verifyRuntimeHostArtifact,
} from "@truss-harness/cli/protocol";

export interface RuntimeHostLaunch {
  readonly source: "configured" | "managed" | "development" | "bundled";
  readonly command: string;
  readonly arguments: readonly string[];
  readonly requiresNodeEnvironment: boolean;
}

export interface RuntimeHostResolutionOptions {
  readonly configuredCommand: string;
  readonly extensionMode: "development" | "production";
  readonly extensionPath: string;
  readonly globalStoragePath: string;
  readonly onDiagnostic: (message: string) => void;
}

/**
 * Chooses a local host without ever treating a network response as executable
 * code. A managed host must have been downloaded and activated through the
 * checksum-verified runtime delivery flow first.
 */
export async function resolveRuntimeHostLaunch(
  options: RuntimeHostResolutionOptions,
): Promise<RuntimeHostLaunch> {
  if (options.configuredCommand)
    return {
      source: "configured",
      command: options.configuredCommand,
      arguments: [],
      requiresNodeEnvironment: false,
    };
  if (options.extensionMode === "development")
    return {
      source: "development",
      command: process.execPath,
      arguments: [resolve(options.extensionPath, "../cli/dist/bin.js")],
      requiresNodeEnvironment: true,
    };

  const runtimeStore = resolve(options.globalStoragePath, "runtime-host");
  const activation = await readRuntimeHostActivation(runtimeStore);
  if (activation) {
    try {
      await verifyRuntimeHostArtifact(
        runtimeStore,
        activation.artifactPath,
        activation.manifest,
      );
      return {
        source: "managed",
        command: process.execPath,
        arguments: [resolve(runtimeStore, activation.artifactPath)],
        requiresNodeEnvironment: true,
      };
    } catch (error) {
      options.onDiagnostic(
        `[runtime host] Ignoring invalid managed runtime: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return {
    source: "bundled",
    command: process.execPath,
    arguments: [resolve(options.extensionPath, "dist/truss-service.cjs")],
    requiresNodeEnvironment: true,
  };
}
