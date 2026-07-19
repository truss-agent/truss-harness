import { describe, expect, it, vi } from "vitest";
import { createWebFetchTool, createWebSearchTool } from "./web.js";

const publicResolver = async (): Promise<readonly string[]> => ["93.184.216.34"];

describe("web tools", () => {
  it("extracts readable text from a public HTML page", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(
      "<html><head><title>Example</title></head><body><main><h1>Current docs</h1><script>ignore()</script><p>Useful text.</p></main></body></html>",
      { headers: { "content-type": "text/html" } }
    ));
    const result = await createWebFetchTool({ fetch, resolveHost: publicResolver }).execute(
      { url: "https://example.com/docs" },
      { workspaceRoot: ".", signal: new AbortController().signal }
    );
    expect(result.content).toContain("Title: Example");
    expect(result.content).toContain("Current docs");
    expect(result.content).toContain("Useful text.");
    expect(result.content).not.toContain("ignore()");
  });

  it("blocks local and private network targets before fetching", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const tool = createWebFetchTool({ fetch, resolveHost: async () => ["127.0.0.1"] });
    await expect(tool.execute(
      { url: "http://localhost:3000" },
      { workspaceRoot: ".", signal: new AbortController().signal }
    )).rejects.toThrow("Local and private");
    await expect(tool.execute(
      { url: "https://internal.example" },
      { workspaceRoot: ".", signal: new AbortController().signal }
    )).rejects.toThrow("Local and private");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns structured search results", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(`
      <div class="result">
        <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs">Example docs</a>
        <div class="result__snippet">The current documentation.</div>
      </div>`, { headers: { "content-type": "text/html" } }));
    const result = await createWebSearchTool({ fetch, resolveHost: publicResolver }).execute(
      { query: "example docs" },
      { workspaceRoot: ".", signal: new AbortController().signal }
    );
    expect(result.content).toContain("1. Example docs");
    expect(result.content).toContain("https://example.com/docs");
    expect(result.content).toContain("current documentation");
  });
});
