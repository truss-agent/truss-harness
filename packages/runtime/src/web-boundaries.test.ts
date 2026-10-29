import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createWebFetchTool } from "./web.js";
import { NodePublicWebTransport } from "./web-transport.js";

const context = { workspaceRoot: "." };
const publicResolver = async () => ["93.184.216.34", "2606:4700:4700::1111"];

describe("public web boundaries", () => {
  it("rejects unsupported HTTP status conversion without crashing and closes the failed response", async () => {
    const source = await readFile(
      new URL("./web-transport.ts", import.meta.url),
      "utf8",
    );
    const module =
      "data:text/javascript;base64," +
      Buffer.from(
        transpileModule(source, {
          compilerOptions: {
            module: ModuleKind.ESNext,
            target: ScriptTarget.ES2022,
          },
        }).outputText,
      ).toString("base64");
    const script = `
      import { createServer } from "node:http";
      import { NodePublicWebTransport } from ${JSON.stringify(module)};
      let failedResponseClosed = false;
      const server = createServer((request, response) => {
        if (request.url === "/bad") {
          response.on("close", () => { failedResponseClosed = true; });
          response.writeHead(600);
          response.write("unsupported status; body deliberately remains open");
        } else response.end("alive");
      });
      await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
      try {
        const port = server.address().port;
        const transport = new NodePublicWebTransport();
        let rejected = false;
        try { await transport.request(new URL("http://example.test:" + port + "/bad"), ["127.0.0.1"], AbortSignal.timeout(1000)); }
        catch (error) { rejected = error instanceof RangeError; }
        const response = await transport.request(new URL("http://example.test:" + port + "/good"), ["127.0.0.1"], AbortSignal.timeout(1000));
        const body = await response.text();
        await new Promise(resolve => setImmediate(resolve));
        console.log(JSON.stringify({ rejected, failedResponseClosed, body }));
      } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
      }
    `;
    const result = await promisify(execFile)(
      process.execPath,
      ["--input-type=module", "--eval", script],
      { timeout: 3000, killSignal: "SIGKILL", maxBuffer: 32_768 },
    );
    expect(JSON.parse(result.stdout)).toEqual({
      rejected: true,
      failedResponseClosed: true,
      body: "alive",
    });
    expect(result.stderr).toBe("");
  });

  it("connects only to pinned addresses while preserving the URL Host", async () => {
    const server = createServer((request, response) =>
      response.end(request.headers.host),
    );
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No port");
      const response = await new NodePublicWebTransport().request(
        new URL(`http://does-not-resolve.invalid:${address.port}/`),
        ["127.0.0.1"],
        new AbortController().signal,
      );
      expect(await response.text()).toBe(
        `does-not-resolve.invalid:${address.port}`,
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("preserves HTTPS certificate verification against the URL hostname, not its pinned IP", async () => {
    const cert = await readFile(
      new URL("../test-fixtures/tls/cert.pem", import.meta.url),
    );
    const key = await readFile(
      new URL("../test-fixtures/tls/key.pem", import.meta.url),
    );
    const server = createHttpsServer({ cert, key }, (request, response) =>
      response.end(request.headers.host),
    );
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No port");
      const transport = new NodePublicWebTransport({ ca: cert });
      const response = await transport.request(
        new URL(`https://public.example.test:${address.port}/`),
        ["127.0.0.1"],
        new AbortController().signal,
      );
      expect(await response.text()).toBe(`public.example.test:${address.port}`);
      await expect(
        transport.request(
          new URL(`https://wrong.example.test:${address.port}/`),
          ["127.0.0.1"],
          new AbortController().signal,
        ),
      ).rejects.toThrow(/hostname|altnames/i);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("passes vetted dual-stack addresses to transport once, with no second resolver lookup", async () => {
    let lookups = 0;
    const result = await createWebFetchTool({
      resolveHost: async () =>
        ++lookups === 1 ? publicResolver() : ["127.0.0.1"],
      transport: {
        async request(url, addresses) {
          if (
            url.hostname !== "example.test" ||
            addresses.join(",") !== "93.184.216.34,2606:4700:4700::1111"
          )
            throw new Error("Unpinned connection");
          return new Response("pinned");
        },
      },
    }).execute({ url: "https://example.test/" }, context);
    expect(result.content).toContain("pinned");
    expect(lookups).toBe(1);
  });

  it("revalidates redirects and disposes redirect bodies before rejecting a private destination", async () => {
    let cancelled = false;
    const tool = createWebFetchTool({
      resolveHost: publicResolver,
      fetch: async () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
          { status: 302, headers: { location: "http://127.0.0.1/" } },
        ),
    });
    await expect(
      tool.execute({ url: "https://example.test/" }, context),
    ).rejects.toThrow("Local and private");
    expect(cancelled).toBe(true);
  });

  it.each<ResponseInit>([
    { status: 500 },
    { headers: { "content-type": "image/png" } },
    { headers: { "content-length": "101" } },
  ])("disposes rejected response bodies %j", async (init) => {
    let cancelled = false;
    const tool = createWebFetchTool({
      resolveHost: publicResolver,
      maxResponseBytes: 100,
      fetch: async () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
          init,
        ),
    });
    await expect(
      tool.execute({ url: "https://example.test/" }, context),
    ).rejects.toThrow();
    expect(cancelled).toBe(true);
  });

  it("bounds lookup lifetime even if a custom resolver never resolves", async () => {
    const tool = createWebFetchTool({
      timeoutMs: 30,
      resolveHost: () => new Promise(() => {}),
    });
    await expect(
      tool.execute({ url: "https://example.test/" }, context),
    ).rejects.toThrow(/timeout|aborted/i);
  });

  it("bounds body lifetime even if a custom fetch stream stalls", async () => {
    let cancelled = false;
    const tool = createWebFetchTool({
      timeoutMs: 30,
      resolveHost: publicResolver,
      fetch: async () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
        ),
    });
    await expect(
      tool.execute({ url: "https://example.test/" }, context),
    ).rejects.toThrow(/timeout|aborted/i);
    expect(cancelled).toBe(true);
  });

  it.each([
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:7f00:1]/",
    "http://[::1]/",
  ])("rejects private IPv6 literals %s", async (url) => {
    await expect(
      createWebFetchTool({
        resolveHost: publicResolver,
        fetch: async () => new Response("unsafe"),
      }).execute({ url }, context),
    ).rejects.toThrow("Local and private");
  });
});
