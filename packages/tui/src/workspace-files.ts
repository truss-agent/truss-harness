import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { useEffect, useMemo, useState } from "react";
import { clamp } from "./display.js";
import {
  buildFileTree,
  type FileEntry,
  fuzzyFiles,
  type SyntaxToken,
  syntaxTokens,
  wrapSyntaxTokens,
} from "./file-browser.js";
import { readWorkingTreeDiff } from "./processes.js";
import type { EditorDisplayRow } from "./types.js";

const ignoredDirectories = new Set([
  ".git",
  ".next",
  ".truss-harness",
  "node_modules",
  "dist",
  "coverage",
]);

export async function collectWorkspaceFiles(
  root: string,
  current = root,
  result: FileEntry[] = [],
): Promise<FileEntry[]> {
  if (result.length >= 2_000) return result;
  for (const entry of await readdir(current, { withFileTypes: true })) {
    if (result.length >= 2_000) break;
    if (entry.isDirectory() && !ignoredDirectories.has(entry.name))
      await collectWorkspaceFiles(root, join(current, entry.name), result);
    if (entry.isFile())
      result.push({ path: relative(root, join(current, entry.name)) });
  }
  return result.sort((left, right) => left.path.localeCompare(right.path));
}

export interface WorkspaceFilesOptions {
  readonly workspaceRoot: string;
  readonly viewportRows: number;
  readonly editorWidth: number;
  readonly editorLineCount: number;
  readonly focusEditor: () => void;
  readonly closeSearch: () => void;
}

export function useWorkspaceFiles({
  workspaceRoot,
  viewportRows,
  editorWidth,
  editorLineCount,
  focusEditor,
  closeSearch,
}: WorkspaceFilesOptions) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [fileIndex, setFileIndex] = useState(0);
  const [collapsedDirectories, setCollapsedDirectories] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [fileSearchInput, setFileSearchInput] = useState("");
  const [fileSearchIndex, setFileSearchIndex] = useState(0);
  const [openFilePath, setOpenFilePath] = useState<string>();
  const [editor, setEditor] = useState(
    "Select a file from the workspace tree.",
  );
  const [editorTitle, setEditorTitle] = useState("Preview");
  const [isDiff, setIsDiff] = useState(false);
  const [editorScroll, setEditorScroll] = useState(0);

  const fileTree = useMemo(
    () => buildFileTree(files, collapsedDirectories),
    [files, collapsedDirectories],
  );
  const selectedFileTreeEntry =
    fileTree[Math.min(fileIndex, Math.max(0, fileTree.length - 1))];
  const fileSearchResults = useMemo(
    () =>
      fuzzyFiles(
        files,
        fileSearchInput,
        Math.max(6, Math.min(14, viewportRows - 10)),
      ),
    [files, fileSearchInput, viewportRows],
  );
  const editorRows = useMemo<readonly EditorDisplayRow[]>(() => {
    const maximumCharacters = Math.max(12, editorWidth - 7);
    return editor.split(/\r?\n/).flatMap((line, sourceIndex) => {
      const color: SyntaxToken["color"] = isDiff
        ? line.startsWith("+") && !line.startsWith("+++")
          ? "green"
          : line.startsWith("-") && !line.startsWith("---")
            ? "red"
            : undefined
        : undefined;
      const tokens: readonly SyntaxToken[] = isDiff
        ? [{ text: line, color }]
        : syntaxTokens(line, openFilePath ?? "");
      return wrapSyntaxTokens(tokens, maximumCharacters).map(
        (row, rowIndex) => ({
          key: `${sourceIndex}:${rowIndex}`,
          sourceLine: sourceIndex + 1,
          continuation: rowIndex > 0,
          tokens: row,
        }),
      );
    });
  }, [editor, editorWidth, isDiff, openFilePath]);
  const visibleEditorRows = editorRows.slice(
    editorScroll,
    editorScroll + editorLineCount,
  );
  const fileTreeStart = clamp(
    fileIndex - Math.floor(editorLineCount / 2),
    0,
    Math.max(0, fileTree.length - editorLineCount),
  );
  const visibleFileTree = fileTree.slice(
    fileTreeStart,
    fileTreeStart + editorLineCount,
  );

  useEffect(() => {
    void collectWorkspaceFiles(workspaceRoot)
      .then(setFiles)
      .catch((error: unknown) =>
        setEditor(`Unable to list workspace files: ${String(error)}`),
      );
  }, [workspaceRoot]);

  useEffect(() => {
    setFileIndex((current) =>
      clamp(current, 0, Math.max(0, fileTree.length - 1)),
    );
  }, [fileTree.length]);

  useEffect(() => {
    setEditorScroll((current) =>
      clamp(current, 0, Math.max(0, editorRows.length - editorLineCount)),
    );
  }, [editorRows.length, editorLineCount]);

  useEffect(() => {
    if (!openFilePath) return;
    const index = fileTree.findIndex(
      (entry) => entry.kind === "file" && entry.path === openFilePath,
    );
    if (index >= 0) setFileIndex(index);
  }, [fileTree, openFilePath]);

  const loadFile = async (entry: FileEntry): Promise<void> => {
    try {
      setIsDiff(false);
      setEditorScroll(0);
      setOpenFilePath(entry.path);
      setEditorTitle(entry.path);
      setEditor(await readFile(join(workspaceRoot, entry.path), "utf8"));
      focusEditor();
    } catch (error) {
      setEditor(
        `Unable to read ${entry.path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const toggleDirectory = (path: string, expand?: boolean): void => {
    setCollapsedDirectories((current) => {
      const next = new Set(current);
      const currentlyExpanded = !next.has(path);
      const shouldExpand = expand ?? !currentlyExpanded;
      if (shouldExpand) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const openSearchResult = (entry: FileEntry): void => {
    const parts = entry.path.replaceAll("\\", "/").split("/");
    parts.pop();
    setCollapsedDirectories((current) => {
      const next = new Set(current);
      let path = "";
      for (const part of parts) {
        path = path ? `${path}/${part}` : part;
        next.delete(path);
      }
      return next;
    });
    setFileSearchInput("");
    setFileSearchIndex(0);
    closeSearch();
    void loadFile(entry);
  };

  const toggleDiff = async (): Promise<void> => {
    if (!openFilePath) return;
    const entry = { path: openFilePath };
    if (isDiff) return void loadFile(entry);
    try {
      setOpenFilePath(entry.path);
      const stdout = await readWorkingTreeDiff(workspaceRoot, entry.path);
      setEditorTitle(`Diff: ${entry.path}`);
      setEditor(stdout || "No working-tree diff for this file.");
      setIsDiff(true);
      setEditorScroll(0);
    } catch (error) {
      setEditor(
        `Unable to load Git diff: ${error instanceof Error ? error.message : String(error)}`,
      );
      setIsDiff(true);
    }
  };

  return {
    files,
    fileIndex,
    setFileIndex,
    fileTree,
    selectedFileTreeEntry,
    fileSearchInput,
    setFileSearchInput,
    fileSearchIndex,
    setFileSearchIndex,
    fileSearchResults,
    openFilePath,
    editorTitle,
    editorScroll,
    setEditorScroll,
    editorRows,
    visibleEditorRows,
    fileTreeStart,
    visibleFileTree,
    loadFile,
    toggleDirectory,
    openSearchResult,
    toggleDiff,
  };
}
