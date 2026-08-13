import { describe, expect, it } from "vitest";
import { InlineResponseBuffer } from "./inline-responses.js";

describe("InlineResponseBuffer", () => {
  it("isolates concurrent streamed responses and releases completed entries", () => {
    const responses = new InlineResponseBuffer();
    responses.begin("first");
    responses.begin("second");
    responses.append("first", "hello");
    responses.append("second", "world");
    responses.append("missing", "ignored");
    expect(responses.value("first")).toBe("hello");
    expect(responses.value("second")).toBe("world");
    responses.end("first");
    expect(responses.value("first")).toBeUndefined();
  });
});
