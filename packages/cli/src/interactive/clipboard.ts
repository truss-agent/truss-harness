import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface ImageData {
  readonly name: string;
  readonly mediaType: string;
  readonly bytes: Buffer;
}

/** Runs a program without a shell and returns its raw standard output. */
export type RunBinary = (
  file: string,
  args: readonly string[],
) => Promise<{ readonly code: number; readonly stdout: Buffer }>;

/** Larger images are refused; providers reject them anyway. */
export const maxImageBytes = 5 * 1024 * 1024;

const imageTypes: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};
const preferredTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export const runBinary: RunBinary = (file, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(file, [...args], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => child.kill(), 10_000);
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      // Stop reading well past the limit; the caller reports the size.
      if (size > maxImageBytes * 2) child.kill();
      else chunks.push(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout: Buffer.concat(chunks) });
    });
  });

function checked(image: ImageData): ImageData {
  if (!image.bytes.length) throw new Error("The clipboard image is empty.");
  if (image.bytes.length > maxImageBytes)
    throw new Error(
      `That image is ${(image.bytes.length / 1024 / 1024).toFixed(1)} MB; the limit is ${maxImageBytes / 1024 / 1024} MB.`,
    );
  return image;
}

function missingTool(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

/**
 * Reads an image from the system clipboard: wl-paste on Wayland, xclip on
 * X11 and osascript on macOS. Returns undefined when the clipboard holds
 * no image.
 */
export async function readClipboardImage(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  run: RunBinary = runBinary,
): Promise<ImageData | undefined> {
  const name = "clipboard image";
  try {
    if (platform === "darwin") {
      const result = await run("osascript", [
        "-e",
        "the clipboard as «class PNGf»",
      ]);
      const hex = /«data PNGf([0-9A-Fa-f]+)»/.exec(
        result.stdout.toString(),
      )?.[1];
      return hex
        ? checked({
            name,
            mediaType: "image/png",
            bytes: Buffer.from(hex, "hex"),
          })
        : undefined;
    }
    if (platform === "win32")
      throw new Error(
        "Pasting images is not supported on Windows yet. Paste the image file's path instead.",
      );
    const wayland = Boolean(environment.WAYLAND_DISPLAY);
    const list = wayland
      ? await run("wl-paste", ["--list-types"])
      : await run("xclip", ["-selection", "clipboard", "-t", "TARGETS", "-o"]);
    const offered = list.stdout.toString().split(/\s+/);
    const mediaType = preferredTypes.find((type) => offered.includes(type));
    if (list.code !== 0 || !mediaType) return undefined;
    const data = wayland
      ? await run("wl-paste", ["--no-newline", "--type", mediaType])
      : await run("xclip", ["-selection", "clipboard", "-t", mediaType, "-o"]);
    return data.code === 0
      ? checked({ name, mediaType, bytes: data.stdout })
      : undefined;
  } catch (error) {
    if (missingTool(error))
      throw new Error(
        environment.WAYLAND_DISPLAY
          ? "Pasting images needs wl-paste. Install wl-clipboard."
          : "Pasting images needs xclip. Install xclip.",
      );
    throw error;
  }
}

/**
 * Pasted or dropped text that names one image file, as a plain, quoted,
 * backslash-escaped or file:// path.
 */
export function imagePathFromText(
  text: string,
  cwd: string,
): string | undefined {
  let value = text.trim();
  if (!value || value.includes("\n")) return undefined;
  if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
  if (value.startsWith("file://")) {
    try {
      value = fileURLToPath(value);
    } catch {
      return undefined;
    }
  } else value = value.replace(/\\(.)/g, "$1");
  if (value === "~" || value.startsWith("~/"))
    value = homedir() + value.slice(1);
  if (!imageTypes[extname(value).toLowerCase()]) return undefined;
  return isAbsolute(value) ? value : resolve(cwd, value);
}

/** Reads an image file named by `imagePathFromText`. */
export async function readImageFile(path: string): Promise<ImageData> {
  const info = await stat(path);
  if (!info.isFile()) throw new Error(`${basename(path)} is not a file.`);
  if (info.size > maxImageBytes)
    throw new Error(
      `${basename(path)} is ${(info.size / 1024 / 1024).toFixed(1)} MB; the limit is ${maxImageBytes / 1024 / 1024} MB.`,
    );
  return checked({
    name: basename(path),
    mediaType: imageTypes[extname(path).toLowerCase()] ?? "image/png",
    bytes: await readFile(path),
  });
}
