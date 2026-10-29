import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";

export const defaultToolOutputBytes = 262_144;
export const defaultContextBytes = 262_144;
const truncationMarker = "\n[Content truncated]";

export function byteLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 2)
    throw new Error("Byte limit must be a safe integer of at least 2.");
  return value;
}

/** Allocates at most the requested UTF-8 budget, preserving complete code points. */
export function truncateUtf8(
  value: string,
  maximumBytes: number,
  force = false,
): string {
  byteLimit(maximumBytes);
  const prefix = Buffer.from(value.slice(0, maximumBytes));
  if (
    !force &&
    value.length <= maximumBytes &&
    prefix.byteLength <= maximumBytes
  )
    return value;
  const marker = truncationMarker.slice(0, maximumBytes);
  const remaining = maximumBytes - Buffer.byteLength(marker);
  return (
    new StringDecoder("utf8").write(
      prefix.subarray(0, Math.max(0, remaining)),
    ) + marker
  );
}

/** Read a bounded prefix from a regular file; never readFile then slice. */
export async function readBoundedText(
  path: string,
  maximumBytes: number,
  signal?: AbortSignal,
): Promise<{ text: string; truncated: boolean }> {
  byteLimit(maximumBytes);
  signal?.throwIfAborted();
  // POSIX FIFO open must not wait for a writer before descriptor validation.
  // Windows has no POSIX FIFO flag; retain its native read-only open semantics.
  const flags =
    process.platform === "win32"
      ? constants.O_RDONLY
      : constants.O_RDONLY | constants.O_NONBLOCK;
  const file = await open(path, flags);
  try {
    signal?.throwIfAborted();
    if (!(await file.stat()).isFile())
      throw new Error("Only regular text files may be read.");
    const buffer = Buffer.alloc(maximumBytes + 1);
    let total = 0;
    while (total < buffer.length) {
      signal?.throwIfAborted();
      const { bytesRead } = await file.read(
        buffer,
        total,
        buffer.length - total,
        null,
      );
      if (!bytesRead) break;
      total += bytesRead;
    }
    const truncated = total > maximumBytes;
    const text = new StringDecoder("utf8").write(buffer.subarray(0, total));
    return { text: truncateUtf8(text, maximumBytes, truncated), truncated };
  } finally {
    await file.close();
  }
}

/** Exact JSON UTF-8 accounting, stopping before serializing an oversized string/object. */
export function boundedJsonBytes(value: unknown, maximum: number): number {
  let total = 0;
  const add = (size: number) => {
    total += size;
  };
  const visit = (entry: unknown): void => {
    if (total > maximum) return;
    if (typeof entry === "string") {
      if (entry.length > maximum - total) {
        total = maximum + 1;
        return;
      }
      add(Buffer.byteLength(JSON.stringify(entry)));
    } else if (entry === null || typeof entry !== "object") {
      add(Buffer.byteLength(JSON.stringify(entry) ?? "null"));
    } else if (Array.isArray(entry)) {
      add(2);
      for (let index = 0; index < entry.length && total <= maximum; index++) {
        if (index) add(1);
        visit(entry[index]);
      }
    } else {
      add(2);
      let first = true;
      for (const key of Object.keys(entry)) {
        const child = (entry as Record<string, unknown>)[key];
        if (child === undefined) continue;
        if (!first) add(1);
        first = false;
        visit(key);
        add(1);
        visit(child);
        if (total > maximum) break;
      }
    }
  };
  visit(value);
  return total;
}
