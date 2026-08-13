import { describe, expect, it } from "vitest";
import { ProgressStreamParser, retryProgress } from "./progress-stream.js";

describe("ProgressStreamParser", () => {
  it("separates progress tags split across provider chunks", () => {
    const parser = new ProgressStreamParser();
    expect(parser.push("Hello <pro")).toEqual({
      content: "Hello ",
      progress: "",
    });
    expect(parser.push("gress>Inspecting")).toEqual({
      content: "",
      progress: "Inspecting",
    });
    expect(parser.push(" files</progress>Done")).toEqual({
      content: "Done",
      progress: " files",
    });
    expect(parser.finish()).toEqual({ content: "", progress: "" });
  });

  it("renders bounded retry status for users", () => {
    expect(
      retryProgress({
        attempt: 2,
        maxAttempts: 3,
        delayMs: 1_500,
        reason: "rate_limited",
        message: "",
      }),
    ).toBe(
      "Provider rate limit reached. Retrying in 2 seconds (attempt 2 of 3).",
    );
  });
});
