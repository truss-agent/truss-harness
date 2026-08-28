import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const releaseDirectory = resolve(repositoryRoot, "release", "runtime-host");
const artifactFileName = "truss-runtime-host.cjs";
const artifactPath = resolve(releaseDirectory, artifactFileName);
const manifestPath = resolve(releaseDirectory, "truss-runtime-host.manifest.json");
const runtimePackage = JSON.parse(
  await readFile(resolve(repositoryRoot, "packages/runtime/package.json"), "utf8"),
);

await rm(releaseDirectory, { recursive: true, force: true });
await mkdir(releaseDirectory, { recursive: true });

await build({
  entryPoints: [resolve(repositoryRoot, "packages/cli/src/bin.ts")],
  outfile: artifactPath,
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
});

const artifact = await readFile(artifactPath);
const manifest = {
  schemaVersion: 1,
  runtime: {
    packageName: runtimePackage.name,
    version: runtimePackage.version,
  },
  artifact: {
    fileName: artifactFileName,
    sha256: createHash("sha256").update(artifact).digest("hex"),
    size: (await stat(artifactPath)).size,
  },
};

await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Created ${artifactPath}`);
console.log(`Created ${manifestPath}`);
