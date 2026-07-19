import nextra from "nextra";

const withNextra = nextra({});

export default withNextra({
  distDir: process.env.TRUSS_DOCS_DIST_DIR ?? ".next",
  reactStrictMode: true
});
