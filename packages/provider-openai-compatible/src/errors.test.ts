import { describe, expect, it } from "vitest";
import { requestError } from "./errors.js";

describe("provider request errors", () => {
  it("maps authentication failures without exposing upstream response text", async () => {
    const error = await requestError(
      new Response("secret credential details", { status: 401 }),
      "Model",
      "test-model",
    );

    expect(error).toMatchObject({ status: 401 });
    expect(error.message).toBe("Model rejected the configured API key (401).");
    expect(error.message).not.toContain("secret credential details");
  });

  it("recognizes disguised rate limits and preserves bounded retry metadata", async () => {
    const error = await requestError(
      new Response(
        JSON.stringify({
          error:
            "Rate limit reached. Limit 200000, Used 99179, Requested 165743. Please try again in 19.476s.",
        }),
        { status: 400 },
      ),
      "Model",
      "test-model",
    );

    expect(error).toMatchObject({ status: 429, retryAfterMs: 19_476 });
    expect(error.message).toBe(
      "Model rate limit reached for test-model. limit 200000 tokens per minute; 99179 used; 165743 requested.",
    );
  });
});
