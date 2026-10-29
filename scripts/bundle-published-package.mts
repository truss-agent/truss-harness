import { build } from "esbuild";
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(
  await readFile(join(root, "package-lock.json"), "utf8"),
);
const selected = process.argv.slice(2);
for (const name of selected.length ? selected : ["runtime", "mcp"]) {
  if (name !== "runtime" && name !== "mcp")
    throw new Error(`Unsupported bundled package: ${name}`);
  const directory = join(root, "packages", name);
  const output = join(directory, "dist/bundled");
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  const result = await build({
    absWorkingDir: root,
    entryPoints: [join(directory, "src/index.ts")],
    outfile: join(output, "index.js"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22.15",
    external: ["@truss-harness/*"],
    banner: {
      js: 'import { createRequire as __trussCreateRequire } from "node:module"; const require = __trussCreateRequire(import.meta.url);',
    },
    legalComments: "eof",
    metafile: true,
  });
  const dependencies = new Map<
    string,
    {
      name: string;
      version: string;
      license: string;
      integrity?: string;
      notices: string[];
    }
  >();
  for (const input of Object.keys(result.metafile.inputs)) {
    if (!input.includes("node_modules/")) continue;
    let path = dirname(resolve(root, input));
    while (path !== root) {
      let manifest: { name: string; version: string; license: string };
      try {
        manifest = JSON.parse(
          await readFile(join(path, "package.json"), "utf8"),
        );
      } catch {
        path = dirname(path);
        continue;
      }
      if (!manifest.name || !manifest.version) {
        path = dirname(path);
        continue;
      }
      const key = relative(root, path).replaceAll("\\", "/");
      if (!dependencies.has(key)) {
        const files = (await readdir(path)).filter((file) =>
          /^(?:licen[sc]e|copying|notice)(?:[.\-_]|$)/i.test(file),
        );
        // boolbase's published tarball omits its ISC notice. This exact-version
        // supplement is preserved from https://github.com/fb55/boolbase/blob/master/LICENSE.
        if (
          !files.length &&
          `${manifest.name}@${manifest.version}` !== "boolbase@1.0.0"
        )
          throw new Error(
            `Bundled dependency has no license notice: ${manifest.name}`,
          );
        const notices = files.length
          ? await Promise.all(
              files.map(
                async (file) =>
                  `${file}\n${await readFile(join(path, file), "utf8")}`,
              ),
            )
          : [
              await readFile(
                join(root, "assets/licenses/boolbase-1.0.0.txt"),
                "utf8",
              ),
            ];
        dependencies.set(key, {
          name: manifest.name,
          version: manifest.version,
          license: manifest.license,
          integrity: lock.packages[key]?.integrity,
          notices,
        });
      }
      break;
    }
  }
  const entries = [...dependencies.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  await writeFile(
    join(output, "dependencies.json"),
    `${JSON.stringify(
      entries.map(({ notices: _notices, ...entry }) => entry),
      null,
      2,
    )}\n`,
  );
  const notices = entries
    .map(
      (entry) =>
        `${entry.name}@${entry.version}\n${entry.notices.join("\n")}\n`,
    )
    .join("\n");
  await writeFile(join(output, "THIRD-PARTY-NOTICES.txt"), notices);
  // Preserve full notices when a client re-bundles this ESM entry into CJS.
  await appendFile(
    join(output, "index.js"),
    `\n/*! Third-party dependency notices\n${notices.replaceAll("*/", "* /")}*/\n`,
  );
  console.log(
    `Bundled ${name} with ${entries.length} external dependency notices; internal Truss packages remain external.`,
  );
}
