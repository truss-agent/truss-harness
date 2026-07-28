# Changelog

All notable desktop release changes are documented in this file.

## [0.1.18] - 2026-07-27

### Fixed

- Preserved keyboard focus across Desktop conversation creation, switching,
  and deletion so chat, editor, terminal, and file-action inputs remain usable
  on Linux.

## [0.1.17] - 2026-07-27

### Added

- Added a Desktop Agents control center for independent workspace-local
  profiles, concurrent Chat and Plan work, serialized Edit work, approvals,
  per-run controls, and recent run details.
- Added bounded local run history and secret-safe lifecycle diagnostics for
  managed-agent cleanup.
- Retained each managed agent's bounded final response so it remains available
  in Desktop, VS Code, and Truss Go after a run completes.

### Fixed

- Made the Desktop file-tree context menu reliable on Linux by handling its
  lifecycle directly in the renderer.
- Prevented a cancelled managed agent from starting after asynchronous session
  creation completes, and verified repeated concurrent cancel/restart cleanup.

## [0.1.16] - 2026-07-26

### Fixed

- Improved Linux file and folder actions, including the file-tree context menu.

### Changed

- Refreshed the public site layout, mobile presentation, and documentation
  navigation.

## [0.1.15] - 2026-07-26

### Fixed

- Made runtime tool execution more tolerant of numeric-string limits from smaller local models and added recovery guidance after a failed tool call, including a clear reminder to use workspace file tools instead of web fetch for local files.

### Added

- Added the Truss wordmark to the desktop header, a workspace/Git/time terminal prompt, browser-preview devtools with F12, and Ctrl/Cmd+D multi-occurrence editing.
- Made workspace file references in chat clickable so they open or focus their editor tab.
- Added Ctrl/Cmd+Z undo and Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y redo for desktop editor changes.

### Changed

- Reworked the Settings experience into a dedicated editor tab with a direct toolbar toggle.
- Pinned the agent tool-call activity feed below the Agent header and retained recent calls for the active conversation.
- Rebalanced the resizable Git, Files, and Chats panels and expanded the terminal command input into a dedicated full-width row.
- Removed the embedded dev-server control in favor of the existing workspace terminal.
- Completed desktop theme coverage for secondary workbench surfaces and custom themes.

### Fixed

- Made the Settings editor tab a properly constrained, scrollable surface so every setting remains reachable; the Apply action stays available while scrolling.
- Preserved the settings panel mount point when opening and closing its editor tab.
- Allowed incomplete settings fields to retain the active provider endpoint/model when saving.
- Stopped managed terminal processes and Truss Go connections when the desktop app exits.
- Suppressed unsupported syntax-parser diagnostics for files such as Lua.
- Bundled Prettier with the production desktop app so the Format control works after installation.
- Installed the Linux launcher icon at the standard `hicolor/512x512` path and aligned the desktop-entry name with Electron's window class.
- Updated Arch package metadata to use supported dependencies and native zstd compression.
