import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8"),
);
const lua = await readFile(resolve(root, "lua/truss/version.lua"), "utf8");
const protocol = await readFile(
  resolve(root, "lua/truss/protocol.lua"),
  "utf8",
);
const errors = [];

function luaString(name) {
  return lua.match(new RegExp(`${name}\\s*=\\s*"([^"]+)"`))?.[1];
}

function luaNumber(name) {
  const value = lua.match(new RegExp(`${name}\\s*=\\s*(\\d+)`))?.[1];
  return value ? Number.parseInt(value, 10) : undefined;
}

function requireEqual(label, actual, expected) {
  if (actual !== expected) {
    errors.push(
      `${label} must be ${JSON.stringify(expected)}; found ${JSON.stringify(actual)}.`,
    );
  }
}

function compareVersions(left, right) {
  const leftParts = left.match(/^(\d+)\.(\d+)\.(\d+)/)?.slice(1);
  const rightParts = right.match(/^(\d+)\.(\d+)\.(\d+)/)?.slice(1);
  if (!leftParts || !rightParts) {
    errors.push(
      `Cannot compare ${JSON.stringify(left)} and ${JSON.stringify(right)} as semantic versions.`,
    );
    return undefined;
  }
  for (let index = 0; index < leftParts.length; index += 1) {
    const difference = Number(leftParts[index]) - Number(rightParts[index]);
    if (difference !== 0) return difference;
  }
  return 0;
}

requireEqual("Lua plugin version", luaString("plugin"), manifest.version);
requireEqual(
  "Lua minimum CLI version",
  luaString("minimum_cli"),
  manifest.truss?.minimumCliVersion,
);
requireEqual(
  "Lua minimum Neovim version",
  luaString("minimum_neovim"),
  manifest.truss?.minimumNeovimVersion,
);
requireEqual(
  "Lua protocol version",
  luaNumber("protocol"),
  manifest.truss?.protocolVersion,
);

if (
  !protocol.includes('local version = require("truss.version")') ||
  !protocol.includes("M.protocol_version = version.protocol") ||
  !protocol.includes("M.client_version = version.plugin")
) {
  errors.push("protocol.lua must consume the centralized version metadata.");
}

try {
  const cliManifest = JSON.parse(
    await readFile(resolve(root, "../cli/package.json"), "utf8"),
  );
  const comparison = compareVersions(
    cliManifest.version,
    manifest.truss?.minimumCliVersion,
  );
  if (comparison !== undefined && comparison < 0) {
    errors.push(
      `Source CLI version ${JSON.stringify(cliManifest.version)} must satisfy the plugin minimum ${JSON.stringify(manifest.truss?.minimumCliVersion)}.`,
    );
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

if (errors.length > 0) {
  process.stderr.write(`${errors.map((error) => `- ${error}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `truss.nvim ${manifest.version}: release metadata is consistent (CLI ${manifest.truss.minimumCliVersion}+, Neovim ${manifest.truss.minimumNeovimVersion}+, protocol v${manifest.truss.protocolVersion}).\n`,
  );
}
