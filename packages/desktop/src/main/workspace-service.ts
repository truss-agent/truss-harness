import { createReadStream, type Dirent } from "node:fs";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import type { DesktopFile } from "../shared.js";

const ignoredDirectories = new Set([
  ".git",
  "node_modules",
  "dist",
  "coverage",
  ".next",
]);
const mediaTypes = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  [".mp4", "video/mp4"],
  [".webm", "video/webm"],
]);

export class WorkspaceService {
  constructor(private readonly workspaceRoot: () => string) {}

  resolvePath(path: string): string {
    const workspace = resolve(this.workspaceRoot());
    const target = resolve(workspace, path);
    if (target !== workspace && !target.startsWith(`${workspace}${sep}`))
      throw new Error("Path must remain inside the selected workspace.");
    return target;
  }

  mediaType(path: string): string | undefined {
    const extension = path.slice(path.lastIndexOf(".")).toLowerCase();
    return mediaTypes.get(extension);
  }

  async mediaResponse(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.hostname !== "workspace")
        return new Response("Unknown media source.", { status: 404 });
      const relativePath = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
      const target = this.resolvePath(relativePath);
      const contentType = this.mediaType(target);
      if (!contentType)
        return new Response("Unsupported media type.", { status: 415 });
      const file = await stat(target);
      if (!file.isFile())
        return new Response("Media file not found.", { status: 404 });

      let start = 0;
      let end = Math.max(0, file.size - 1);
      let status = 200;
      const range = request.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
      if (range && file.size > 0) {
        if (!range[1] && range[2]) {
          const suffixLength = Math.min(
            file.size,
            Number.parseInt(range[2], 10),
          );
          start = file.size - suffixLength;
        } else {
          start = Number.parseInt(range[1] || "0", 10);
          end = range[2]
            ? Math.min(file.size - 1, Number.parseInt(range[2], 10))
            : file.size - 1;
        }
        if (
          !Number.isFinite(start) ||
          !Number.isFinite(end) ||
          start < 0 ||
          end < start ||
          start >= file.size
        ) {
          return new Response(null, {
            status: 416,
            headers: { "content-range": `bytes */${file.size}` },
          });
        }
        status = 206;
      }

      const length = file.size ? end - start + 1 : 0;
      const headers: Record<string, string> = {
        "accept-ranges": "bytes",
        "cache-control": "no-store",
        "content-length": String(length),
        "content-type": contentType,
      };
      if (status === 206)
        headers["content-range"] = `bytes ${start}-${end}/${file.size}`;
      if (request.method === "HEAD" || file.size === 0)
        return new Response(null, { status, headers });
      const body = Readable.toWeb(
        createReadStream(target, { start, end }),
      ) as ReadableStream<Uint8Array>;
      return new Response(body, { status, headers });
    } catch {
      return new Response("Media file not found.", { status: 404 });
    }
  }

  async collectFiles(): Promise<DesktopFile[]> {
    const root = this.workspaceRoot();
    const files: DesktopFile[] = [];
    const visit = async (current: string): Promise<void> => {
      let entries: Dirent[];
      try {
        entries = await readdir(current, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const entryPath = join(current, entry.name);
        const workspacePath = relative(root, entryPath);
        if (entry.isDirectory()) {
          files.push({ path: workspacePath, type: "directory" });
          if (!ignoredDirectories.has(entry.name)) await visit(entryPath);
        } else if (entry.isFile() || entry.isSymbolicLink()) {
          files.push({ path: workspacePath, type: "file" });
        }
      }
    };
    await visit(root);
    return files.sort((left, right) => left.path.localeCompare(right.path));
  }

  async listDirectory(path: string): Promise<DesktopFile[]> {
    const root = this.workspaceRoot();
    const directory = this.resolvePath(path);
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter(
        (entry) =>
          entry.isDirectory() || entry.isFile() || entry.isSymbolicLink(),
      )
      .map((entry) => ({
        path: relative(root, join(directory, entry.name)),
        type: entry.isDirectory() ? ("directory" as const) : ("file" as const),
      }))
      .sort((left, right) =>
        left.type === right.type
          ? left.path.localeCompare(right.path)
          : left.type === "directory"
            ? -1
            : 1,
      );
  }

  readFile(path: string): Promise<string> {
    return readFile(this.resolvePath(path), "utf8");
  }

  async writeFile(path: string, content: string): Promise<void> {
    if (typeof content !== "string")
      throw new Error("File content must be text.");
    if (content.length > 5_000_000)
      throw new Error("Files larger than 5 MB cannot be edited in Truss.");
    await writeFile(this.resolvePath(path), content, "utf8");
  }

  async createFile(path: string): Promise<void> {
    const target = this.resolvePath(path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, "", { encoding: "utf8", flag: "wx" });
  }

  async createFolder(path: string): Promise<void> {
    await mkdir(this.resolvePath(path));
  }

  async rename(path: string, nextPath: string): Promise<void> {
    await rename(this.resolvePath(path), this.resolvePath(nextPath));
  }

  async copy(path: string, destinationPath: string): Promise<void> {
    const source = this.resolvePath(path);
    const destination = this.resolvePath(destinationPath);
    if ((await stat(source)).isDirectory())
      throw new Error(
        "Copying folders is not supported yet. Create a folder and copy its files instead.",
      );
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination, 1);
  }

  async delete(path: string): Promise<void> {
    const target = this.resolvePath(path);
    if (resolve(target) === resolve(this.workspaceRoot()))
      throw new Error("The workspace root cannot be deleted.");
    await rm(target, { recursive: true, force: false });
  }
}
