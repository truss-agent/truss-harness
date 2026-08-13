import type { DesktopFile } from "../../shared.js";

export type FileContextTarget = {
  readonly kind: "root" | "directory" | "file";
  readonly path: string;
};

function normalizedPath(path: string): string {
  return path.replaceAll("\\", "/");
}

export function fuzzyPathScore(
  path: string,
  query: string,
): number | undefined {
  const target = path.toLocaleLowerCase();
  const needle = query.toLocaleLowerCase();
  let position = 0;
  let score = 0;
  for (const character of needle) {
    const next = target.indexOf(character, position);
    if (next === -1) return undefined;
    score += next - position;
    position = next + 1;
  }
  return score + (target.includes(needle) ? -30 : 0) + path.length / 1_000;
}

export function normalizedWorkspaceEntry(value: string): string | undefined {
  const normalized = value.trim().replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || /^[a-z]:/i.test(normalized))
    return undefined;
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === ".."))
    return undefined;
  return normalized;
}

export function entryParent(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

export function entryName(path: string): string {
  return path.split("/").at(-1) ?? path;
}

export function childEntryPath(
  parent: string,
  name: string,
): string | undefined {
  const normalizedName = normalizedWorkspaceEntry(name);
  if (!normalizedName) return undefined;
  return parent ? `${parent}/${normalizedName}` : normalizedName;
}

/** Owns file-tree entries, filtering, expansion, loading, and copy state. */
export class WorkspaceFilesController {
  entries: readonly DesktopFile[] = [];
  query = "";
  copiedPath: string | undefined;
  readonly expandedDirectories = new Set<string>();
  readonly loadedDirectories = new Set<string>();

  replace(entries: readonly DesktopFile[]): void {
    this.entries = entries
      .map((entry) => ({
        ...entry,
        path: normalizedPath(entry.path),
      }))
      .sort((left, right) => left.path.localeCompare(right.path));
    this.loadedDirectories.clear();
  }

  merge(entries: readonly DesktopFile[]): void {
    const merged = new Map(
      this.entries.map((file) => [normalizedPath(file.path), file]),
    );
    for (const file of entries) {
      const path = normalizedPath(file.path);
      merged.set(path, { ...file, path });
    }
    this.entries = [...merged.values()].sort((left, right) =>
      left.path.localeCompare(right.path),
    );
  }

  isExpanded(path: string): boolean {
    return this.expandedDirectories.has(normalizedPath(path));
  }

  toggleExpanded(path: string): boolean {
    const normalized = normalizedPath(path);
    if (this.expandedDirectories.delete(normalized)) return false;
    this.expandedDirectories.add(normalized);
    return true;
  }

  markExpanded(path: string): void {
    if (path) this.expandedDirectories.add(normalizedPath(path));
  }

  needsDirectory(path: string): boolean {
    return !this.loadedDirectories.has(normalizedPath(path));
  }

  markDirectoryLoaded(path: string): void {
    this.loadedDirectories.add(normalizedPath(path));
  }

  moveDirectoryState(previousPath: string, nextPath: string): void {
    const previous = normalizedPath(previousPath);
    const next = normalizedPath(nextPath);
    const wasExpanded = this.expandedDirectories.delete(previous);
    this.loadedDirectories.delete(previous);
    if (wasExpanded) this.expandedDirectories.add(next);
  }

  removeDirectoryState(path: string): void {
    const normalized = normalizedPath(path);
    this.expandedDirectories.delete(normalized);
    this.loadedDirectories.delete(normalized);
  }

  clearCopiedWithin(path: string, includeChildren: boolean): void {
    const normalized = normalizedPath(path);
    if (
      this.copiedPath === normalized ||
      (includeChildren && this.copiedPath?.startsWith(`${normalized}/`))
    )
      this.copiedPath = undefined;
  }

  reset(): void {
    this.entries = [];
    this.query = "";
    this.copiedPath = undefined;
    this.expandedDirectories.clear();
    this.loadedDirectories.clear();
  }
}
