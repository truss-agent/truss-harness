import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DesktopStateStore } from "./desktop-state-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("DesktopStateStore", () => {
  it("returns safe defaults when no state exists", async () => {
    const directory = await mkdtemp(join(tmpdir(), "truss-state-"));
    temporaryDirectories.push(directory);
    const store = new DesktopStateStore(
      join(directory, "state.json"),
      "/workspace",
    );

    expect(await store.load()).toMatchObject({
      workspaceRoot: "/workspace",
      zoomFactor: 1,
      updates: { checkOnLaunch: true, autoDownload: false },
      conversations: [],
    });
  });

  it("bounds persisted state and writes stable JSON", async () => {
    const directory = await mkdtemp(join(tmpdir(), "truss-state-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "state.json");
    await writeFile(
      path,
      JSON.stringify({
        workspaceRoot: "/saved",
        zoomFactor: 99,
        conversations: Array.from({ length: 40 }, (_, index) => ({
          id: String(index),
        })),
      }),
    );
    const store = new DesktopStateStore(path, "/fallback");
    const state = await store.load();

    expect(state.zoomFactor).toBe(2);
    expect(state.conversations).toHaveLength(30);
    await store.save(state);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(state);
  });
});
