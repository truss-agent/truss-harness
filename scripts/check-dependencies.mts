import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

interface Advisory {
  url: string;
  range: string;
}
interface Vulnerability {
  via: (string | Advisory)[];
  nodes: string[];
}
interface Audit {
  vulnerabilities?: Record<string, Vulnerability>;
  error?: unknown;
}

// Issue #270: unresolved upstream build-tooling advisory, not a library repair.
// Owner: @jrh89. Only trusted, reviewed Expo config/plugins are in scope.
// Review on config/plugin ingress changes, any new consumer, or a patched release.
const exceptionExpires = "2026-11-28T00:00:00Z";
const expoBuildGroups = new Set([
  "deepmerge",
  "@expo/config",
  "@expo/cli",
  "@expo/metro-config",
  "@expo/prebuild-config",
  "expo",
  "expo-asset",
  "expo-constants",
]);

export function verifyAudit(audit: Audit, now = new Date()): string[] {
  if (audit.error || !audit.vulnerabilities)
    throw new Error(
      "Dependency audit did not return a valid vulnerability graph",
    );
  const unresolved: string[] = [];
  for (const [name, vulnerability] of Object.entries(audit.vulnerabilities)) {
    if (now >= new Date(exceptionExpires) || !expoBuildGroups.has(name))
      throw new Error(`Unapproved dependency advisory: ${name}`);
    for (const via of vulnerability.via) {
      if (typeof via === "string") {
        if (!expoBuildGroups.has(via))
          throw new Error(`Unapproved dependency advisory: ${name} via ${via}`);
      } else if (
        name !== "deepmerge" ||
        via.url !== "https://github.com/advisories/GHSA-gcqx-w48m-w2h4" ||
        via.range !== ">=4.2.0 <=4.3.1"
      ) {
        throw new Error(
          `Unapproved dependency advisory: ${name} via ${via.url}`,
        );
      }
    }
    if (
      name === "deepmerge" &&
      (vulnerability.nodes.length !== 1 ||
        vulnerability.nodes[0] !== "node_modules/deepmerge")
    )
      throw new Error(
        "Expo exception does not cover additional deepmerge copies",
      );
    unresolved.push(name);
  }
  return unresolved;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const result = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["audit", "--json"],
    { encoding: "utf8", shell: process.platform === "win32" },
  );
  if (result.error) throw result.error;
  const audit: Audit = JSON.parse(result.stdout);
  const unresolved = verifyAudit(audit);
  console.log(JSON.stringify(audit, null, 2));
  console.log(
    unresolved.length
      ? `UNRESOLVED Expo build exception (owner @jrh89, issue #270, expires ${exceptionExpires}): ${unresolved.join(", ")}`
      : "No dependency advisories reported.",
  );
}
