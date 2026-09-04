import { describe, expect, it } from "vitest";
import { controlEndpoint } from "./model-discovery.js";

describe("Control Center local model discovery", () => {
  it("normalizes the standard LM Studio endpoint and maps llama.cpp to the compatible API", () => {
    expect(
      controlEndpoint("openai-compatible", "http://127.0.0.1:1234"),
    ).toMatchObject({
      kind: "openai-compatible",
      baseUrl: "http://127.0.0.1:1234/v1",
    });
    expect(
      controlEndpoint("llama-cpp", "http://127.0.0.1:8080/v1"),
    ).toMatchObject({ id: "llama-cpp", kind: "openai-compatible" });
  });
});
