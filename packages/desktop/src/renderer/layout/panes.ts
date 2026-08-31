export interface SidebarTracks {
  readonly git: number;
  readonly files: number;
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function balancedSidebarTracks(
  sidebarHeight: number,
  splitterHeight: number,
  gitCollapsed: boolean,
): SidebarTracks {
  const availableHeight = sidebarHeight - splitterHeight;
  if (gitCollapsed) return { git: 38, files: Math.max(110, availableHeight - 38) };
  const git = Math.max(160, Math.floor(availableHeight * .38));
  return { git, files: Math.max(110, availableHeight - git) };
}

export function collapsedSidebarTracks(tracks: SidebarTracks): SidebarTracks {
  const releasedHeight = Math.max(0, tracks.git - 38);
  return { git: 38, files: tracks.files + releasedHeight };
}

export function expandedSidebarTracks(
  tracks: SidebarTracks,
  previousGitHeight: number,
): SidebarTracks {
  const restoredGit = Math.min(previousGitHeight, Math.max(38, tracks.files - 110 + 38));
  const neededHeight = Math.max(0, restoredGit - 38);
  return { git: restoredGit, files: tracks.files - neededHeight };
}

export function resizeSidebarTracks(
  tracks: SidebarTracks,
  sidebarHeight: number,
  splitterHeight: number,
  gitCollapsed: boolean,
): SidebarTracks {
  const availableHeight = Math.max(220, sidebarHeight - splitterHeight);
  if (gitCollapsed) return { git: 38, files: Math.max(110, availableHeight - 38) };
  const git = Math.max(160, Math.min(tracks.git, availableHeight - 110));
  return { git, files: Math.max(110, availableHeight - git) };
}
