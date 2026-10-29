import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

it("indexes real HTML, loads fragments and rejects missing representative search results", () => {
  const dir = mkdtempSync(join(tmpdir(), "truss-search-policy-"));
  const html = join(dir, "html");
  mkdirSync(html);
  const page = join(html, "index.html");
  const run = () =>
    spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        resolve("scripts/verify-docs-search.mts"),
        html,
        join(dir, "search"),
      ],
      { encoding: "utf8" },
    );
  try {
    writeFileSync(
      page,
      '<html lang="en"><body data-pagefind-body><h1>Ollama MCP configuration</h1><p>Connect a local provider.</p></body></html>',
    );
    const valid = run();
    expect(valid.status, valid.stderr).toBe(0);
    expect(valid.stdout).toContain(
      "Verified Pagefind query configuration: 1 results",
    );
    writeFileSync(
      page,
      '<html lang="en"><body data-pagefind-body><h1>Unrelated content</h1></body></html>',
    );
    const missing = run();
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain("Pagefind has no results for Ollama");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);
