# Contributing to Truss

Thanks for helping improve Truss. This repository powers several clients over a shared, provider-agnostic runtime, so every change must clearly state the client it is intended to fix.

## Before you start

1. Search the [issue tracker](https://github.com/truss-agent/truss-harness/issues) for an existing report.
2. If no issue exists, open one before writing the fix. Select every affected client and include steps to reproduce the problem.
3. Create a branch from the current `master` branch. Do not commit, push, or open pull requests from `master`.

```bash
git switch master
git pull --ff-only origin master
git switch -c fix/123-short-description
```

Use a descriptive branch name such as `fix/123-terminal-timeout` or `docs/456-client-setup`. Replace `123` with the issue number where possible.

## Client scope

Every issue and pull request must name one or more affected clients:

| Client | Package |
| --- | --- |
| VS Code | `packages/vscode` |
| Desktop | `packages/desktop` |
| CLI | `packages/cli` |
| TUI | `packages/tui` |
| Documentation site | `packages/docs` |

Use **Repository infrastructure** only for CI, templates, or other repository-maintenance work that does not change a client. Client fixes must name the client they affect.

Changes to shared packages, such as `runtime`, `mcp`, `provider-openai-compatible`, or `branding`, must also list every client whose behavior, build, or distribution may be affected. Describe that impact in the pull request.

## Develop and validate

Keep changes focused on the linked issue. Add or update tests when behavior changes.

Run the repository checks before requesting review:

```bash
npm ci
npm run build
npm test
```

Also build every client you touched (and every client affected by a shared-package change):

```bash
npm --workspace truss-harness-vscode run build
npm --workspace @truss-harness/desktop run build
npm --workspace @truss-harness/cli run build
npm --workspace @truss-harness/tui run build
npm --workspace @truss-harness/docs run build
```

Run only the commands that apply to the client scope of your change. The pull-request workflow repeats the common checks and builds affected clients, but local validation helps catch problems sooner.

## Open a pull request

Open the pull request from your branch into `master`. Complete the pull-request template, including the affected client(s), validation performed, and issue reference. Use a closing keyword in the description, for example:

```text
Closes #123
```

Pull requests without a linked issue should be updated to link one before review. Do not merge your own pull request unless the repository maintainers have explicitly granted that permission.

## Maintainers

Protect `master` in GitHub so direct pushes and force-pushes are blocked, pull requests are required, and the `Pull request checks` workflow must pass before merging. Repository policy cannot be enforced solely by this file.
