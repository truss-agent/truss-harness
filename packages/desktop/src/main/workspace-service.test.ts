import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceService } from "./workspace-service.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("WorkspaceService", () => {
  it("keeps paths inside the workspace and lists directories first", async () => {
    const root = await mkdtemp(join(tmpdir(), "truss-workspace-"));
    temporaryDirectories.push(root);
    await mkdir(join(root, "src"));
    await writeFile(join(root, "README.md"), "hello");
    const service = new WorkspaceService(() => root);

    expect(() => service.resolvePath("../outside")).toThrow(
      "Path must remain inside",
    );
    expect(await service.listDirectory(".")).toEqual([
      { path: "src", type: "directory" },
      { path: "README.md", type: "file" },
    ]);
  });

  it("supports range requests for workspace media", async () => {
    const root = await mkdtemp(join(tmpdir(), "truss-workspace-"));
    temporaryDirectories.push(root);
    await writeFile(join(root, "image.png"), Buffer.from("abcdef"));
    const service = new WorkspaceService(() => root);

    const response = await service.mediaResponse(
      new Request("truss-media://workspace/image.png", {
        headers: { Range: "bytes=1-3" },
      }),
    );

    expect(response.status).toBe(206);
    expect(await response.text()).toBe("bcd");
    expect(response.headers.get("content-range")).toBe("bytes 1-3/6");
  });
});
