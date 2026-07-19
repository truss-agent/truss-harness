import nextra from "nextra";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const withNextra = nextra({});
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export default withNextra({
  distDir: process.env.TRUSS_DOCS_DIST_DIR ?? ".next",
  outputFileTracingRoot: repositoryRoot,
  reactStrictMode: true,
  webpack(config) {
    config.resolve.alias["@truss-harness/branding"] = resolve(repositoryRoot, "packages/branding/dist/index.js");
    return config;
  }
});
