import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { FileWorkspaceTrustStore } from "./workspace-trust.js";
it("preserves independent trust receipts across concurrent host writes without storing content", async () => {
  const root = await mkdtemp(join(tmpdir(), "truss-trust-"));
  try {
    const path = join(root, "user", "trust.json");
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        new FileWorkspaceTrustStore(root, path).trust(
          `profile:${i}`,
          `synthetic-secret-${i}`,
        ),
      ),
    );
    const store = new FileWorkspaceTrustStore(root, path);
    for (let i = 0; i < 8; i++)
      expect(
        await store.isTrusted(`profile:${i}`, `synthetic-secret-${i}`),
      ).toBe(true);
    expect(await readFile(path, "utf8")).not.toContain("synthetic-secret");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
