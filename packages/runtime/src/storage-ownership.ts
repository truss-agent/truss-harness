import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout } from "node:timers/promises";

/** Ownership covers a complete read/modify/write transaction, including other processes. */
export interface WorkspaceStorageOwnership {
  run<T>(path: string, transaction: () => Promise<T>): Promise<T>;
}
interface Owner {
  readonly pid: number;
  readonly token: string;
}
function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

/** Filesystem-backed default; injectable for hosts with a different storage lifecycle. */
export class FileWorkspaceStorageOwnership
  implements WorkspaceStorageOwnership
{
  private readonly pending = new Map<string, Promise<void>>();

  run<T>(path: string, transaction: () => Promise<T>): Promise<T> {
    const operation = (this.pending.get(path) ?? Promise.resolve()).then(
      async () => {
        await mkdir(dirname(path), { recursive: true });
        const release = await this.acquire(`${path}.lock`);
        try {
          return await transaction();
        } finally {
          await release();
        }
      },
    );
    // A caller sees its own failure, while later operations always get a settled queue tail.
    const tail = operation.then(
      () => undefined,
      () => undefined,
    );
    this.pending.set(path, tail);
    void tail.then(() => {
      if (this.pending.get(path) === tail) this.pending.delete(path);
    });
    return operation;
  }

  private async owner(path: string): Promise<Owner | undefined> {
    try {
      const value = JSON.parse(await readFile(path, "utf8")) as Partial<Owner>;
      if (
        !Number.isSafeInteger(value.pid) ||
        value.pid! < 1 ||
        typeof value.token !== "string" ||
        !/^[a-f0-9-]{36}$/.test(value.token)
      )
        throw new Error("Invalid owner record");
      return value as Owner;
    } catch (error) {
      if (hasCode(error, "ENOENT")) return undefined;
      throw new Error(
        `Cannot establish workspace storage lock owner at ${path}`,
        { cause: error },
      );
    }
  }

  private async acquire(path: string): Promise<() => Promise<void>> {
    const owner: Owner = { pid: process.pid, token: randomUUID() };
    const claim = `${path}.${owner.pid}.${owner.token}.claim`;
    let acquired = false;
    // Publish a fully written owner record atomically, so a crash cannot leave an empty lock.
    try {
      await writeFile(claim, JSON.stringify(owner), { flag: "wx" });
      const deadline = Date.now() + 10_000;
      for (;;) {
        try {
          await link(claim, path);
          acquired = true;
          return () => rm(path, { force: true });
        } catch (error) {
          if (!hasCode(error, "EEXIST")) throw error;
        }
        const holder = await this.owner(path);
        if (!holder) continue;
        let alive = true;
        try {
          process.kill(holder.pid, 0);
        } catch (error) {
          if (hasCode(error, "ESRCH")) alive = false;
          else
            throw new Error(
              `Cannot establish whether storage owner ${holder.pid} is alive`,
              { cause: error },
            );
        }
        if (!alive) {
          // One reaper per stale token. Recheck under that ownership before unlinking,
          // so concurrent recovery never removes a newly acquired live lock.
          const releaseReaper = await this.acquire(
            `${path}.reap.${holder.token}`,
          );
          try {
            if ((await this.owner(path))?.token === holder.token)
              await rm(path, { force: true });
          } finally {
            await releaseReaper();
          }
          continue;
        }
        if (Date.now() >= deadline)
          throw new Error(
            `Timed out waiting for live workspace storage owner ${holder.pid}: ${path}`,
          );
        await setTimeout(5);
      }
    } finally {
      try {
        await rm(claim, { force: true });
      } catch (error) {
        if (acquired) await rm(path, { force: true });
        throw error;
      }
    }
  }
}
