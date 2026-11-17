# Unified Truss command Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** One npm installation provides `truss` and `truss tui`.
**Architecture:** A launcher imports the selected existing client executable, preserving process and terminal ownership.
**Tech Stack:** Strict TypeScript, npm workspaces, Vitest.
**Spec:** docs/superpowers/specs/2026-11-16-truss-command-design.md

## Global Constraints
- Preserve standalone packages, legacy commands, Node >=22.15.1 and editor protocols.
- Issue #304; dedicated feature branch; version changes before PR; publish only merged master.

## Review Focus
- CLI flags and arguments pass through unchanged.
- TUI help works without a terminal; interactive input and interrupts keep working.
- Working directory, service stdin, and failure exit codes survive dispatch.
- Published exports resolve outside the monorepo.
- Current docs agree on the bundled install, while legacy editor defaults remain valid.

### Task 1: Launcher and executable interfaces
**Files:** packages/truss/{package.json,tsconfig.json,src/bin.ts,src/launcher.test.ts}, packages/{cli,tui}/package.json, packages/cli/src/bin.ts, packages/tui/src/bin.tsx, tsconfig.json, package-lock.json.
**Interfaces:** consumes executable exports `@truss-harness/cli/bin` and `@truss-harness/tui/bin`; produces npm `truss`.
- [x] Write launch regression tests for CLI help/version/config path, TUI help/non-TTY failure, and invalid CLI command status. Run and observe failure before launcher exists.
- [x] Add launcher package, executable exports, command-aware help; update CLI/TUI versions.
- [x] Build, run focused tests, and verify a packed install outside the repo.

### Task 2: Documentation and release
**Files:** README.md, packages/{cli,tui,truss}/README.md, packages/docs current installation/usage pages, scripts/sync-brand-assets.mjs, package.json.
**Interfaces:** documents Task 1 commands; packaging includes the launcher.
- [x] Update current docs and release notes; preserve historical changelogs and legacy editor defaults.
- [x] Run formatting, lint, build, full tests, affected client and docs builds.
- [ ] Review the whole branch, fix material findings, commit, push and immediately open linked template PR.
- [ ] Wait required checks, merge, publish packages from merged master, tag npm release, verify registry and clean installation, install locally.
