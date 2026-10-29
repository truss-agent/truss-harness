import nextra from "nextra";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const withNextra = nextra({});
const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export default withNextra({
  distDir: process.env.TRUSS_DOCS_DIST_DIR ?? ".next",
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
  webpack(config) {
    config.resolve.alias["@truss-harness/branding"] = resolve(
      repositoryRoot,
      "packages/branding/dist/index.js",
    );
    return config;
  },
});
