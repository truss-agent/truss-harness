import { lstatSync, realpathSync } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

/** Replaceable pathname policy shared by workspace tools, stores and clients. */
export interface WorkspaceFilesystemPolicy {
  resolvePath(workspaceRoot: string, candidate: string): string;
}

function contained(root: string, target: string): boolean {
  const path = relative(root, target);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

/** Resolve the nearest existing parent, including file symlinks. Dangling links fail closed. */
function canonicalPath(path: string): string {
  try {
    lstatSync(path);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return resolve(canonicalPath(parent), basename(path));
  }
  try {
    return realpathSync(path);
  } catch {
    throw new Error(
      "Unable to resolve workspace path (possibly a dangling symlink)",
    );
  }
}

/**
 * Checks lexical and canonical containment before each filesystem operation.
 * Pathname checks cannot prevent concurrent hostile symlink swaps; an OS sandbox
 * or handle-relative filesystem API is needed for that stronger guarantee.
 */
export class CanonicalWorkspaceFilesystemPolicy
  implements WorkspaceFilesystemPolicy
{
  resolvePath(workspaceRoot: string, candidate: string): string {
    if (!candidate) throw new Error("Path must be a non-empty string");
    if (isAbsolute(candidate))
      throw new Error("Absolute paths are not allowed");
    const root = resolve(workspaceRoot);
    const fullPath = resolve(root, candidate);
    if (
      !contained(root, fullPath) ||
      !contained(canonicalPath(root), canonicalPath(fullPath))
    ) {
      throw new Error("Path escapes workspace");
    }
    return fullPath;
  }
}

/** Backwards-compatible synchronous resolver. */
export function resolveWorkspacePath(
  workspaceRoot: string,
  candidate: string,
): string {
  return new CanonicalWorkspaceFilesystemPolicy().resolvePath(
    workspaceRoot,
    candidate,
  );
}
