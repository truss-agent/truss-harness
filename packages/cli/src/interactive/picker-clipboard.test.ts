import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  imagePathFromText,
  maxImageBytes,
  type RunBinary,
  readClipboardImage,
  readImageFile,
} from "./clipboard.js";
import type { KeyEvent } from "./input.js";
import { openPicker, reducePicker, renderPicker } from "./picker.js";
import { createStyle } from "./renderer.js";

const key = (type: string, text?: string) =>
  (text === undefined ? { type } : { type, text }) as KeyEvent;
const plain = createStyle(false);

describe("picker", () => {
  const items = ["chat", "plan", "edit"].map((value) => ({
    label: value,
    value,
    current: value === "plan",
  }));

  it("starts on the current item, moves, wraps and picks with Enter", () => {
    let state = openPicker("Mode", items);
    expect(state.index).toBe(1);
    state = reducePicker(state, key("down")).state;
    state = reducePicker(state, key("down")).state;
    expect(state.index).toBe(0);
    expect(reducePicker(state, key("enter")).picked?.value).toBe("chat");
  });

  it("picks short lists by number and cancels with Escape", () => {
    const state = openPicker("Mode", items);
    expect(reducePicker(state, key("text", "3")).picked?.value).toBe("edit");
    expect(reducePicker(state, key("text", "9")).picked).toBeUndefined();
    expect(reducePicker(state, key("escape")).cancelled).toBe(true);
  });

  it("filters long lists by typed text", () => {
    const models = Array.from({ length: 30 }, (_, index) => ({
      label: `model-${index}`,
      value: `model-${index}`,
    }));
    let state = openPicker("Model", models);
    expect(state.filterable).toBe(true);
    for (const character of "-2")
      state = reducePicker(state, key("text", character)).state;
    state = reducePicker(state, key("down")).state;
    expect(reducePicker(state, key("enter")).picked?.value).toBe("model-20");
    state = reducePicker(state, key("backspace")).state;
    expect(state.filter).toBe("-");
  });

  it("renders numbers, the current marker and a key hint", () => {
    const view = renderPicker(openPicker("Mode", items), 60, plain);
    expect(view.lines[0]).toBe("Mode");
    expect(view.lines[2]).toContain("●  2. plan");
    expect(view.lines.at(-1)).toContain("Enter choose");
  });
});

describe("image paste", () => {
  it("recognises pasted and dropped image paths", () => {
    expect(imagePathFromText("/tmp/a.png", "/w")).toBe("/tmp/a.png");
    expect(imagePathFromText("'/tmp/my shot.JPG'", "/w")).toBe(
      "/tmp/my shot.JPG",
    );
    expect(imagePathFromText("/tmp/my\\ shot.webp", "/w")).toBe(
      "/tmp/my shot.webp",
    );
    expect(imagePathFromText("file:///tmp/a%20b.gif", "/w")).toBe(
      "/tmp/a b.gif",
    );
    expect(imagePathFromText("shots/a.png", "/w")).toBe("/w/shots/a.png");
    expect(imagePathFromText("~/a.png", "/w")).toBe(join(homedir(), "a.png"));
    expect(imagePathFromText("notes.txt", "/w")).toBeUndefined();
    expect(imagePathFromText("look at a.png\nplease", "/w")).toBeUndefined();
  });

  it("reads image files and refuses oversized ones", async () => {
    const root = await mkdtemp(join(tmpdir(), "truss-image-"));
    try {
      await writeFile(join(root, "a.png"), Buffer.from([137, 80, 78, 71]));
      const image = await readImageFile(join(root, "a.png"));
      expect(image).toMatchObject({ name: "a.png", mediaType: "image/png" });
      await writeFile(join(root, "big.png"), Buffer.alloc(maxImageBytes + 1));
      await expect(readImageFile(join(root, "big.png"))).rejects.toThrow(
        /limit/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reads a Wayland clipboard image with wl-paste", async () => {
    const run = vi.fn<RunBinary>(async (_file, args) =>
      args[0] === "--list-types"
        ? { code: 0, stdout: Buffer.from("text/plain\nimage/png\n") }
        : { code: 0, stdout: Buffer.from([1, 2, 3]) },
    );
    const image = await readClipboardImage(
      { WAYLAND_DISPLAY: "wayland-1" },
      "linux",
      run,
    );
    expect(image?.mediaType).toBe("image/png");
    expect(run.mock.calls[1]).toEqual([
      "wl-paste",
      ["--no-newline", "--type", "image/png"],
    ]);
  });

  it("returns nothing for a text clipboard and explains a missing tool", async () => {
    const text: RunBinary = async () => ({
      code: 0,
      stdout: Buffer.from("text/plain"),
    });
    expect(await readClipboardImage({}, "linux", text)).toBeUndefined();
    const missing: RunBinary = async () => {
      throw Object.assign(new Error("spawn xclip ENOENT"), { code: "ENOENT" });
    };
    await expect(readClipboardImage({}, "linux", missing)).rejects.toThrow(
      "Install xclip",
    );
  });

  it("decodes the macOS clipboard PNG", async () => {
    const run: RunBinary = async () => ({
      code: 0,
      stdout: Buffer.from("«data PNGf89504E47»"),
    });
    const image = await readClipboardImage({}, "darwin", run);
    expect([...(image?.bytes ?? [])]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
});
