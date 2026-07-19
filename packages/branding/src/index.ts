/**
 * The single code-level source of truth for product-facing names and local paths.
 * Change these values, then run `npm run brand:sync` to refresh copied client assets.
 */
export const brand = Object.freeze({
  productName: "Truss",
  productSlug: "truss-harness",
  cliCommand: "truss-cli",
  tuiCommand: "truss-tui",
  workspaceDirectory: ".truss-harness",
  agentInstructionsFile: "AGENTS.md",
  assetDirectory: "assets/brand",
  vscodeActivityBarIcon: "logo_vs.svg",
  repositoryUrl: "https://github.com/truss-agent/truss-harness",
  repositoryBranch: "master"
});

export type Brand = typeof brand;
