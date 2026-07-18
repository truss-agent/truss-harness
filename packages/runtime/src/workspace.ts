import { isAbsolute, relative, resolve } from "node:path";

export function resolveWorkspacePath(workspaceRoot: string, candidate: string): string {
  if (!candidate) throw new Error("Path must be a non-empty string");
  if (isAbsolute(candidate)) throw new Error("Absolute paths are not allowed");

  const root = resolve(workspaceRoot);
  const fullPath = resolve(root, candidate);
  const fromRoot = relative(root, fullPath);

  if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new Error("Path escapes workspace");
  }

  return fullPath;
}
