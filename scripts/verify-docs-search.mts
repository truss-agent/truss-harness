import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const site = resolve(process.argv[2] ?? "");
const output = resolve(process.argv[3] ?? "");
if (!process.argv[2] || !process.argv[3] || site === output)
  throw new Error("Pass separate HTML and search output directories");
const pagefindBin = resolve(
  dirname(fileURLToPath(import.meta.resolve("pagefind"))),
  "runner/bin.cjs",
);
const build = spawnSync(
  process.execPath,
  [pagefindBin, "--site", site, "--output-path", output],
  { stdio: "inherit" },
);
if (build.error) throw build.error;
if (build.status !== 0)
  throw new Error(`Pagefind indexing failed (${build.status})`);
const server = createServer(async (request, response) => {
  try {
    const path = resolve(
      output,
      `.${new URL(request.url ?? "/", "http://localhost").pathname}`,
    );
    if (relative(output, path).startsWith(".."))
      throw new Error("Invalid search asset path");
    response.end(await readFile(path));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string")
  throw new Error("Search server did not bind");
const code = await readFile(resolve(output, "pagefind.js"), "utf8");
const moduleUrl = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
const pagefind = await import(moduleUrl);
try {
  await pagefind.options({
    basePath: `http://127.0.0.1:${address.port}/`,
    baseUrl: "/",
    noWorker: true,
  });
  for (const term of ["Ollama", "MCP", "configuration"]) {
    const result = await pagefind.search(term);
    if (!result.results.length)
      throw new Error(`Pagefind has no results for ${term}`);
    const fragment = await result.results[0].data();
    if (!fragment.url || !fragment.content)
      throw new Error(`Pagefind fragment missing for ${term}`);
    console.log(
      `Verified Pagefind query ${term}: ${result.results.length} results`,
    );
  }
} finally {
  await pagefind.destroy();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
