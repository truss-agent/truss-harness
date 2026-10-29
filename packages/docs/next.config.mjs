import nextra from "nextra";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

// Remove when the published theme includes the full-props validation fix:
// https://github.com/shuding/nextra/blob/main/packages/nextra-theme-docs/src/layout.tsx
// The 4.6.1 build validates themeConfig after removing children. Keep that
// configuration boundary intact, omitting only the separately rendered child.
export function patchNextraLayout(source, originalDirectory, version) {
  const hash = createHash("sha256").update(source).digest("hex");
  if (
    version !== "4.6.1" ||
    hash !== "866ab731a6d8cbd21a42480788ec04b994d33eef3173217b755e9ba45d8bb911"
  ) {
    throw new Error(
      "Nextra layout changed: review/remove the Zod compatibility adapter before building.",
    );
  }
  return source
    .replace(
      "LayoutPropsSchema.safeParse(themeConfig)",
      "LayoutPropsSchema.omit({ children: true }).safeParse(themeConfig)",
    )
    .replace(
      /from "(\.\/[^\"]+)"/g,
      (_, path) =>
        `from ${JSON.stringify(resolve(originalDirectory, path).replaceAll("\\", "/"))}`,
    );
}

const withNextra = nextra({});
const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const docsRoot = resolve(repositoryRoot, "packages/docs");
const distDir = process.env.TRUSS_DOCS_DIST_DIR ?? ".next";
const themeDirectory = dirname(
  createRequire(import.meta.url).resolve("nextra-theme-docs/style.css"),
);
const themeLayout = resolve(themeDirectory, "layout.js");

export default withNextra({
  distDir,
  outputFileTracingRoot: repositoryRoot,
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
          },
          // Measure the broader policy before enforcing it. Inline scripts/styles
          // support static Next/Nextra output; Vercel analytics is the only external
          // script/connect integration. Pagefind uses same-origin workers and WASM.
          {
            key: "Content-Security-Policy-Report-Only",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://va.vercel-scripts.com",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self' data:",
              "connect-src 'self' https://*.vercel-insights.com",
              "worker-src 'self' blob:",
              "frame-ancestors 'none'",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
  webpack(config, { webpack, dev }) {
    const cacheDirectory = resolve(
      docsRoot,
      ".next-compat",
      distDir,
      dev ? "development" : "production",
    );
    const patchedLayout = resolve(cacheDirectory, "layout.js");
    const source = readFileSync(themeLayout, "utf8");
    const version = JSON.parse(
      readFileSync(resolve(themeDirectory, "../package.json"), "utf8"),
    ).version;
    const license = readFileSync(resolve(themeDirectory, "../LICENSE"), "utf8");
    mkdirSync(cacheDirectory, { recursive: true });
    writeFileSync(
      patchedLayout,
      `/*! Nextra theme compatibility adapter. ${license.replaceAll("*/", "* /")} */\n${patchNextraLayout(source, themeDirectory, version)}`,
    );
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(
        /(?:^|\/)layout(?:\.js)?$/,
        (resource) => {
          const candidate = resolve(
            resource.context,
            resource.request.endsWith(".js")
              ? resource.request
              : `${resource.request}.js`,
          );
          if (candidate === themeLayout) resource.request = patchedLayout;
        },
      ),
    );
    config.resolve.alias["@truss-harness/branding"] = resolve(
      repositoryRoot,
      "packages/branding/dist/index.js",
    );
    return config;
  },
});
