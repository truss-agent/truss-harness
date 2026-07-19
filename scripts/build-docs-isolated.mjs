import { createRequire } from "node:module";
import { readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docsRoot = join(repositoryRoot, "packages", "docs");
const outputDirectoryName = ".next-release-check";
const outputDirectory = resolve(docsRoot, outputDirectoryName);
const tsconfigPath = join(docsRoot, "tsconfig.json");
const nextEnvPath = join(docsRoot, "next-env.d.ts");

if (relative(docsRoot, outputDirectory).startsWith("..")) {
  throw new Error(`Refusing to use an output directory outside the docs workspace: ${outputDirectory}`);
}

const [tsconfig, nextEnv] = await Promise.all([
  readFile(tsconfigPath),
  readFile(nextEnvPath),
]);

let status = 1;

try {
  await rm(outputDirectory, { force: true, recursive: true });

  const require = createRequire(import.meta.url);
  const nextBin = require.resolve("next/dist/bin/next", { paths: [docsRoot] });
  const result = spawnSync(process.execPath, [nextBin, "build"], {
    cwd: docsRoot,
    env: {
      ...process.env,
      TRUSS_DOCS_DIST_DIR: outputDirectoryName,
    },
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  status = result.status ?? 1;
} finally {
  await Promise.all([
    writeFile(tsconfigPath, tsconfig),
    writeFile(nextEnvPath, nextEnv),
    rm(outputDirectory, { force: true, recursive: true }),
  ]);
}

process.exitCode = status;
