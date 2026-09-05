import { cloudProviderDefinition } from "@truss-harness/provider-openai-compatible";
import { describe, expect, it, vi } from "vitest";
import { discoverCloudModels } from "./cloud-model-discovery.js";

describe("desktop cloud model discovery", () => {
  it("authenticates Anthropic model requests and follows cursor pages", async () => {
    const requestFetch = vi.fn<typeof fetch>(async (input, init) => {
      const headers = new Headers(init?.headers);
      if (
        headers.get("x-api-key") !== "test-key" ||
        headers.get("anthropic-version") !== "2023-06-01"
      )
        return new Response(null, { status: 400 });
      expect(headers.has("authorization")).toBe(false);
      const url = new URL(String(input));
      expect(url.origin + url.pathname).toBe(
        "https://api.anthropic.com/v1/models",
      );
      const first = !url.searchParams.has("after_id");
      if (!first)
        expect(url.searchParams.get("after_id")).toBe("claude-sonnet-test");
      return Response.json({
        data: first
          ? [
              {
                id: "claude-sonnet-test",
                type: "model",
                max_input_tokens: 200_000,
              },
            ]
          : [{ id: "claude-haiku-test", type: "model" }],
        has_more: first,
        last_id: first ? "claude-sonnet-test" : "claude-haiku-test",
      });
    });
    const models = await discoverCloudModels(
      cloudProviderDefinition("anthropic"),
      "https://api.anthropic.com/v1/",
      "test-key",
      requestFetch,
    );
    expect(models.map(({ id }) => id)).toEqual([
      "claude-sonnet-test",
      "claude-haiku-test",
    ]);
    expect(models[0].contextWindow).toBe(200_000);
    expect(requestFetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    { has_more: false, last_id: "claude-test" },
    { has_more: true, last_id: null },
  ])("stops without a usable next cursor: %j", async (pagination) => {
    const requestFetch = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        data: [{ id: "claude-test" }],
        ...pagination,
      }),
    );
    expect(
      await discoverCloudModels(
        cloudProviderDefinition("anthropic"),
        "https://api.anthropic.com/v1",
        "test-key",
        requestFetch,
      ),
    ).toHaveLength(1);
    expect(requestFetch).toHaveBeenCalledTimes(1);
  });

  it("stops repeated Anthropic cursors and deduplicates models", async () => {
    const requestFetch = vi.fn<typeof fetch>().mockImplementation(async () =>
      Response.json({
        data: [{ id: "claude-test" }],
        has_more: true,
        last_id: "claude-test",
      }),
    );
    expect(
      await discoverCloudModels(
        cloudProviderDefinition("anthropic"),
        "https://api.anthropic.com/v1",
        "test-key",
        requestFetch,
      ),
    ).toHaveLength(1);
    expect(requestFetch).toHaveBeenCalledTimes(2);
  });

  it("preserves Bearer authentication, page tokens, and filtering for other providers", async () => {
    const requestFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          data: [{ id: "chat-model" }, { id: "text-embedding-test" }],
          nextPageToken: "next page",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ data: [{ id: "chat-model" }, { id: "second-chat" }] }),
      );
    const models = await discoverCloudModels(
      cloudProviderDefinition("gemini"),
      "https://example.test/v1",
      "test-key",
      requestFetch,
    );
    expect(models.map(({ id }) => id)).toEqual(["chat-model", "second-chat"]);
    expect(requestFetch).toHaveBeenNthCalledWith(
      2,
      "https://example.test/v1/models?pageToken=next+page",
      {
        headers: { Authorization: "Bearer test-key" },
      },
    );
  });

  it("preserves Ollama Cloud's tags endpoint and response shape", async () => {
    const requestFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ models: [{ name: "coding-model" }] }));
    expect(
      await discoverCloudModels(
        cloudProviderDefinition("ollama-cloud"),
        "https://ollama.com",
        "test-key",
        requestFetch,
      ),
    ).toEqual([{ id: "coding-model" }]);
    expect(requestFetch).toHaveBeenCalledWith("https://ollama.com/api/tags", {
      headers: { Authorization: "Bearer test-key" },
    });
  });

  it("reports the provider and HTTP failure without echoing response credentials", async () => {
    const requestFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("test-key", { status: 401 }));
    await expect(
      discoverCloudModels(
        cloudProviderDefinition("anthropic"),
        "https://api.anthropic.com/v1",
        "test-key",
        requestFetch,
      ),
    ).rejects.toThrow("Anthropic model discovery failed (401).");
  });
});
