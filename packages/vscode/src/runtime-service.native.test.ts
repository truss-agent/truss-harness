import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { RuntimeService } from "./runtime-service.js";
it("rejects crashed real fixture hosts and later requests without hanging", async () => {
  const root = await mkdtemp(join(tmpdir(), "truss-host-lifecycle-"));
  const script = join(root, "host.cjs");
  await writeFile(
    script,
    `require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.type==='initialize')process.stdout.write(JSON.stringify({type:'response',requestId:r.requestId,result:{protocolVersion:1,server:{name:'truss-cli',version:'test',identity:{runtime:{packageName:'@truss-harness/runtime',version:'0.1.0'},protocolVersions:[1]}}}})+'\\n');else process.exit(7);});`,
  );
  const service = new RuntimeService(
    process.execPath,
    [script],
    root,
    process.env,
    () => {},
    () => {},
  );
  try {
    await service.waitUntilReady();
    await expect(service.run("crash").result).rejects.toThrow(/exited/);
    await expect(service.createSession([])).rejects.toThrow(/exited/);
  } finally {
    service.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
it("bounds initialization and rejects spawn failures", async () => {
  const missing = new RuntimeService(
    "/nonexistent/truss-fixture",
    [],
    tmpdir(),
    {},
    () => {},
    () => {},
  );
  await expect(missing.waitUntilReady()).rejects.toThrow();
  missing.dispose();
  const silent = new RuntimeService(
    process.execPath,
    ["-e", "setInterval(()=>{},1000)", "--"],
    tmpdir(),
    process.env,
    () => {},
    () => {},
    () => {},
    30,
  );
  try {
    await expect(silent.waitUntilReady()).rejects.toThrow(/timed out/);
  } finally {
    silent.dispose();
  }
});
