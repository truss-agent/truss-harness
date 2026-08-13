import { describe, expect, it } from "vitest";
import { detectedPreviewUrl, normalizedPreviewUrl } from "./processes.js";

describe("TUI process helpers", () => {
  it("detects and normalizes a local development URL", () => {
    expect(detectedPreviewUrl("ready at http://0.0.0.0:5173/app).")).toBe(
      "http://127.0.0.1:5173/app",
    );
  });

  it("accepts host input and rejects unsafe protocols", () => {
    expect(normalizedPreviewUrl("localhost:3000")).toBe(
      "http://localhost:3000/",
    );
    expect(() => normalizedPreviewUrl("file:///tmp/demo")).toThrow(
      "Preview URLs must use HTTP or HTTPS.",
    );
  });
});
