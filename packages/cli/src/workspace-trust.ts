import {
  FileWorkspaceStorageOwnership,
  type WorkspaceStorageOwnership,
} from "@truss-harness/runtime";
import { createHash, randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface WorkspaceTrustStore {
  isTrusted(resource: string, content: string): Promise<boolean>;
  trust(resource: string, content: string): Promise<void>;
}
export function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** User-owned receipts contain only canonical-workspace/resource and content hashes. */
export class FileWorkspaceTrustStore implements WorkspaceTrustStore {
  constructor(
    private readonly workspaceRoot: string,
    readonly path: string,
    private readonly ownership: WorkspaceStorageOwnership = new FileWorkspaceStorageOwnership(),
  ) {}
  private async key(resource: string): Promise<string> {
    return contentHash(`${await realpath(this.workspaceRoot)}\0${resource}`);
  }
  private async records(): Promise<Record<string, string>> {
    try {
      const value: unknown = JSON.parse(await readFile(this.path, "utf8"));
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        !Object.values(value).every((item) => typeof item === "string")
      )
        throw new Error("Invalid workspace trust records");
      return value as Record<string, string>;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return {};
      throw error;
    }
  }
  async isTrusted(resource: string, content: string): Promise<boolean> {
    return (
      (await this.records())[await this.key(resource)] === contentHash(content)
    );
  }
  async trust(resource: string, content: string): Promise<void> {
    await this.ownership.run(this.path, async () => {
      const records = await this.records();
      records[await this.key(resource)] = contentHash(content);
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify(records, null, 2)}\n`, {
          encoding: "utf8",
          mode: 0o600,
        });
        await rename(temporary, this.path);
      } finally {
        await rm(temporary, { force: true });
      }
    });
  }
}
