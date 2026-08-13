import { relative, resolve, sep } from "node:path";
import { brand } from "@truss-harness/branding";
import type { ContextBlock, WorkspacePlan } from "@truss-harness/runtime";
import * as vscode from "vscode";

export function workspaceRoot(): string {
  return (
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ??
    vscode.workspace.workspaceFile?.fsPath ??
    process.cwd()
  );
}

export async function activeWorkspacePlan(): Promise<
  WorkspacePlan | undefined
> {
  try {
    const path = resolve(
      workspaceRoot(),
      brand.workspaceDirectory,
      "plans",
      "active.json",
    );
    return JSON.parse(
      new TextDecoder().decode(
        await vscode.workspace.fs.readFile(vscode.Uri.file(path)),
      ),
    ) as WorkspacePlan;
  } catch {
    return undefined;
  }
}

export async function workspaceFiles(): Promise<readonly string[]> {
  const root = workspaceRoot();
  const files = await vscode.workspace.findFiles(
    "**/*",
    "**/{.git,node_modules,dist,coverage,.next}/**",
    800,
  );
  return files
    .map((file) => relative(root, file.fsPath).replaceAll("\\", "/"))
    .filter((file) => file && !file.startsWith(".."))
    .sort((left, right) => left.localeCompare(right));
}

function activeEditorWorkspaceFile():
  | { readonly path: string; readonly content: string }
  | undefined {
  const editor = vscode.window.activeTextEditor;
  if (editor?.document.uri.scheme !== "file") return undefined;
  const root = resolve(workspaceRoot());
  const target = resolve(editor.document.uri.fsPath);
  if (target === root || !target.startsWith(`${root}${sep}`)) return undefined;
  return {
    path: relative(root, target).replaceAll("\\", "/"),
    content: editor.document.getText(),
  };
}

export async function workspaceFileContext(
  attachedPaths: readonly string[] | undefined,
): Promise<readonly ContextBlock[]> {
  const root = resolve(workspaceRoot());
  const activeFile = activeEditorWorkspaceFile();
  const paths = [
    ...new Set(
      [activeFile?.path, ...(attachedPaths ?? [])].filter(
        (path): path is string => Boolean(path),
      ),
    ),
  ].slice(0, 8);
  const blocks: ContextBlock[] = [];
  let remaining = 80_000;
  for (const path of paths) {
    if (remaining <= 0) break;
    const target = resolve(root, path);
    if (target !== root && !target.startsWith(`${root}${sep}`)) continue;
    try {
      const isPrimary = path === activeFile?.path;
      const content = isPrimary
        ? activeFile.content
        : new TextDecoder().decode(
            await vscode.workspace.fs.readFile(vscode.Uri.file(target)),
          );
      const clipped = content.slice(
        0,
        Math.min(isPrimary ? 12_000 : 30_000, remaining),
      );
      blocks.push({
        source: `${isPrimary ? "active-file" : "attached-file"}:${path}`,
        content: isPrimary
          ? `This is the currently open workspace file and the primary context for this request. Tool results produced later in the run take precedence over this request-start snapshot.\n\n${clipped}`
          : clipped,
        priority: isPrimary ? 1_000 : 100,
      });
      remaining -= clipped.length;
    } catch {
      // A selected file can disappear or become unavailable before the request is sent.
    }
  }
  return blocks;
}
