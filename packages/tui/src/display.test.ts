import { describe, expect, it } from "vitest";
import {
  chatDisplayLines,
  configuredContextWindow,
  plainChatText,
  visibleLines,
} from "./display.js";

describe("TUI display helpers", () => {
  it("renders pending assistant messages as thinking", () => {
    expect(
      chatDisplayLines([{ role: "assistant", content: "" }], true, 40),
    ).toEqual([
      { key: "0:header", role: "assistant", text: "AGENT", header: true },
      { key: "0:0", role: "assistant", text: "Thinking...", header: false },
    ]);
  });

  it("removes chat markdown while preserving code contents", () => {
    expect(
      plainChatText("## Result\n**ready**\n```ts\nconst ok = true;\n```"),
    ).toBe("Result\nready\n  const ok = true;");
  });

  it("selects bounded lines from the end of a transcript", () => {
    expect(visibleLines(["a", "b", "c", "d"], 2, 1)).toEqual(["b", "c"]);
  });

  it("bounds invalid and extreme context-window values", () => {
    expect(configuredContextWindow("invalid")).toBe(8_192);
    expect(configuredContextWindow("12")).toBe(512);
    expect(configuredContextWindow("2000000")).toBe(1_000_000);
  });
});
