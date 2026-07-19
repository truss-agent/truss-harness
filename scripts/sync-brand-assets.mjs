import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const brandSource = await readFile(resolve(root, "packages/branding/src/index.ts"), "utf8");

function readBrandValue(key) {
  const match = brandSource.match(new RegExp(`${key}:\\s*["']([^"']+)["']`));
  if (!match) {
    throw new Error(`Missing ${key} in packages/branding/src/index.ts.`);
  }

  return match[1];
}

const brand = Object.freeze({
  productName: readBrandValue("productName"),
  productSlug: readBrandValue("productSlug"),
  cliCommand: readBrandValue("cliCommand"),
  tuiCommand: readBrandValue("tuiCommand"),
  assetDirectory: readBrandValue("assetDirectory"),
  vscodeActivityBarIcon: readBrandValue("vscodeActivityBarIcon"),
  repositoryUrl: readBrandValue("repositoryUrl").replace(/\/$/, "")
});

const npmRepositoryUrl = `git+${brand.repositoryUrl}.git`;
const packageScope = `@${brand.productSlug}`;
const extensionNamespace = brand.productSlug.replace(/-([a-z0-9])/g, (_, character) => character.toUpperCase());
const workspacePackageNames = new Set(["branding", "runtime", "provider-openai-compatible", "cli", "tui", "desktop", "docs"]);
const publishablePackageNames = ["branding", "runtime", "provider-openai-compatible", "cli", "tui"];

async function updatePackageJson(relativePath, update) {
  const filePath = resolve(root, relativePath);
  const manifest = JSON.parse(await readFile(filePath, "utf8"));
  update(manifest);
  await writeFile(filePath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function applyRepositoryMetadata(manifest, useNpmUrl = true) {
  manifest.repository = {
    type: "git",
    url: useNpmUrl ? npmRepositoryUrl : brand.repositoryUrl
  };
  manifest.bugs = { url: `${brand.repositoryUrl}/issues` };
  manifest.homepage = `${brand.repositoryUrl}#readme`;
}

function applyWorkspaceDependencies(manifest) {
  for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    const dependencies = manifest[section];
    if (!dependencies) continue;

    for (const [name, version] of Object.entries(dependencies)) {
      const packageName = name.split("/").at(-1);
      if (!workspacePackageNames.has(packageName)) continue;
      delete dependencies[name];
      dependencies[`${packageScope}/${packageName}`] = version;
    }
  }
}

function includeLogoInPackage(manifest) {
  manifest.files = [...new Set([...(manifest.files ?? []).filter((file) => file !== "logo.svg"), "logo.png"])];
}

function createWindowsIcon(png) {
  const directory = Buffer.alloc(22);
  directory.writeUInt16LE(0, 0);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(1, 4);
  directory[6] = 0;
  directory[7] = 0;
  directory[8] = 0;
  directory[9] = 0;
  directory.writeUInt16LE(1, 10);
  directory.writeUInt16LE(32, 12);
  directory.writeUInt32LE(png.length, 14);
  directory.writeUInt32LE(22, 18);
  return Buffer.concat([directory, png]);
}

function replaceExtensionNamespace(value, previousNamespace) {
  return value.replaceAll(previousNamespace, extensionNamespace);
}

function applyExtensionIdentity(manifest) {
  const container = manifest.contributes.viewsContainers.activitybar[0];
  const previousNamespace = container.id;
  container.id = extensionNamespace;
  container.title = brand.productName;
  container.icon = `media/${brand.productSlug}.svg`;

  manifest.name = `${brand.productSlug}-vscode`;
  manifest.publisher = brand.productSlug;
  manifest.icon = `media/${brand.productSlug}.png`;
  manifest.activationEvents = manifest.activationEvents.map((event) => replaceExtensionNamespace(event, previousNamespace));

  const views = manifest.contributes.views[previousNamespace] ?? manifest.contributes.views[extensionNamespace] ?? [];
  manifest.contributes.views = {
    [extensionNamespace]: views.map((view) => ({ ...view, id: replaceExtensionNamespace(view.id, previousNamespace) }))
  };
  manifest.contributes.commands = manifest.contributes.commands.map((command) => ({
    ...command,
    command: replaceExtensionNamespace(command.command, previousNamespace),
    title: command.title.replace(/^[^:]+:/, `${brand.productName}:`)
  }));

  manifest.contributes.configuration.title = brand.productName;
  manifest.contributes.configuration.properties = Object.fromEntries(
    Object.entries(manifest.contributes.configuration.properties).map(([key, setting]) => [
      replaceExtensionNamespace(key, previousNamespace),
      setting
    ])
  );
  const commandSetting = manifest.contributes.configuration.properties[`${extensionNamespace}.command`];
  commandSetting.default = brand.cliCommand;
  commandSetting.description = `Path to the ${brand.productName} CLI executable.`;
}

await Promise.all([
  updatePackageJson("package.json", (manifest) => {
    manifest.name = brand.productSlug;
    manifest.scripts.build = `npm run brand:sync && tsc -b && npm --workspace ${brand.productSlug}-vscode run bundle`;
    manifest.scripts["docs:dev"] = `npm run brand:sync && npm --workspace ${packageScope}/branding run build && npm --workspace ${packageScope}/docs run dev`;
    manifest.scripts["docs:build"] = `npm run brand:sync && npm --workspace ${packageScope}/branding run build && npm --workspace ${packageScope}/docs run build`;
  }),
  updatePackageJson("packages/branding/package.json", (manifest) => {
    manifest.name = `${packageScope}/branding`;
    manifest.description = `Shared product identity configuration for ${brand.productName} clients.`;
    includeLogoInPackage(manifest);
    applyRepositoryMetadata(manifest);
  }),
  updatePackageJson("packages/runtime/package.json", (manifest) => {
    manifest.name = `${packageScope}/runtime`;
    applyWorkspaceDependencies(manifest);
    includeLogoInPackage(manifest);
    applyRepositoryMetadata(manifest);
  }),
  updatePackageJson("packages/provider-openai-compatible/package.json", (manifest) => {
    manifest.name = `${packageScope}/provider-openai-compatible`;
    manifest.description = `OpenAI-compatible streaming model provider for ${brand.productName}.`;
    applyWorkspaceDependencies(manifest);
    includeLogoInPackage(manifest);
    applyRepositoryMetadata(manifest);
  }),
  updatePackageJson("packages/cli/package.json", (manifest) => {
    manifest.name = `${packageScope}/cli`;
    manifest.description = `Command-line client and runtime service for ${brand.productName}.`;
    manifest.bin = { [brand.cliCommand]: "./dist/bin.js" };
    applyWorkspaceDependencies(manifest);
    includeLogoInPackage(manifest);
    applyRepositoryMetadata(manifest);
  }),
  updatePackageJson("packages/tui/package.json", (manifest) => {
    manifest.name = `${packageScope}/tui`;
    manifest.description = `Interactive terminal client for ${brand.productName}.`;
    manifest.bin = { [brand.tuiCommand]: "./dist/bin.js" };
    applyWorkspaceDependencies(manifest);
    includeLogoInPackage(manifest);
    applyRepositoryMetadata(manifest);
  }),
  updatePackageJson("packages/desktop/package.json", (manifest) => {
    manifest.name = `${packageScope}/desktop`;
    manifest.description = `Standalone desktop client for the ${brand.productName} runtime.`;
    manifest.build.productName = brand.productName;
    manifest.build.appId = `com.${brand.productSlug}.desktop`;
    manifest.build.linux.executableName = brand.productSlug;
    applyWorkspaceDependencies(manifest);
    applyRepositoryMetadata(manifest);
  }),
  updatePackageJson("packages/docs/package.json", (manifest) => {
    manifest.name = `${packageScope}/docs`;
    applyWorkspaceDependencies(manifest);
  }),
  updatePackageJson("packages/vscode/package.json", (manifest) => {
    manifest.displayName = brand.productName;
    manifest.description = `VS Code client for the ${brand.productName} runtime.`;
    applyWorkspaceDependencies(manifest);
    applyRepositoryMetadata(manifest, false);
    applyExtensionIdentity(manifest);
  })
]);

const logoSourcePath = resolve(root, brand.assetDirectory, "logo.svg");
const logoSvg = await readFile(logoSourcePath, "utf8");
const logoPng = await readFile(resolve(root, brand.assetDirectory, "logo.png"));

await copyFile(
  resolve(root, brand.assetDirectory, brand.vscodeActivityBarIcon),
  resolve(root, "packages/vscode/media/truss-harness.svg")
);
await mkdir(resolve(root, "packages/docs/public"), { recursive: true });
await mkdir(resolve(root, "packages/desktop/assets"), { recursive: true });
await Promise.all([
  copyFile(logoSourcePath, resolve(root, "packages/docs/public/brand-logo.svg")),
  writeFile(resolve(root, "packages/docs/public/brand-logo.png"), logoPng),
  writeFile(resolve(root, "packages/docs/app/icon.png"), logoPng),
  writeFile(resolve(root, "packages/vscode/media/truss-harness.png"), logoPng),
  writeFile(resolve(root, "packages/desktop/assets/brand-logo.png"), logoPng),
  writeFile(resolve(root, "packages/desktop/assets/brand-logo.ico"), createWindowsIcon(logoPng)),
  ...publishablePackageNames.map((packageName) =>
    writeFile(resolve(root, `packages/${packageName}/logo.png`), logoPng)
  )
]);
await Promise.all(["branding", "runtime", "provider-openai-compatible", "cli", "tui", "vscode"].map((packageName) =>
  copyFile(resolve(root, "LICENSE"), resolve(root, `packages/${packageName}/LICENSE`))
));
process.stdout.write("Synchronized brand display metadata, logo assets, and package licenses.\n");
