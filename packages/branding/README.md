# Brand Configuration

<p align="center"><img src="./logo.png" width="96" alt="Truss logo"></p>

`src/index.ts` is the source of truth for product-facing names, command names, workspace-local paths, assets, and documentation links.

After changing it, run `npm run brand:sync`. The command updates the npm workspace scope and package names, CLI and TUI executable names, package descriptions and repository links, VS Code extension publisher/name, VS Code commands, views, setting keys, display text, default CLI path, and copies `vscodeActivityBarIcon` plus the Marketplace logo into the packaged extension. `repositoryBranch` identifies the branch used by documentation source links.

The docs shell reads this module directly, so its navbar, metadata, footer, repository link, and "Edit this page" URLs use the configured product name and repository URL.

Package folders and the TypeScript import specifiers in authored source remain implementation paths. A new product identity should be configured before release work begins, then rebuilt and republished as a new npm scope and VS Code extension identity.
