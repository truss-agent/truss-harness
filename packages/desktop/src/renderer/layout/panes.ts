export interface SidebarTracks {
  readonly git: number;
  readonly files: number;
  readonly history: number;
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
  if (gitCollapsed) {
    const sharedHeight = Math.max(110, Math.floor((availableHeight - 38) / 2));
    return { git: 38, files: sharedHeight, history: sharedHeight };
  }
  const sharedHeight = Math.max(110, Math.floor(availableHeight / 3));
  return { git: sharedHeight, files: sharedHeight, history: sharedHeight };
}

export function collapsedSidebarTracks(tracks: SidebarTracks): SidebarTracks {
  const releasedHeight = Math.max(0, tracks.git - 38);
  const filesGain = Math.floor(releasedHeight / 2);
  return {
    git: 38,
    files: tracks.files + filesGain,
    history: tracks.history + releasedHeight - filesGain,
  };
}

export function expandedSidebarTracks(
  tracks: SidebarTracks,
  previousGitHeight: number,
): SidebarTracks {
  const restoredGit = Math.min(
    previousGitHeight,
    Math.max(38, tracks.files + tracks.history - 220 + 38),
  );
  const neededHeight = Math.max(0, restoredGit - 38);
  const availableFiles = Math.max(0, tracks.files - 110);
  const availableHistory = Math.max(0, tracks.history - 110);
  const availableTotal = availableFiles + availableHistory;
  const fromFiles = Math.min(
    availableFiles,
    Math.round(neededHeight * (availableFiles / Math.max(1, availableTotal))),
  );
  const fromHistory = Math.min(availableHistory, neededHeight - fromFiles);
  return {
    git: restoredGit,
    files: tracks.files - fromFiles,
    history: tracks.history - fromHistory,
  };
}

export function resizeSidebarTracks(
  tracks: SidebarTracks,
  sidebarHeight: number,
  splitterHeight: number,
  gitCollapsed: boolean,
): SidebarTracks {
  const availableHeight = Math.max(220, sidebarHeight - splitterHeight);
  if (gitCollapsed) {
    const remainingHeight = Math.max(220, availableHeight - 38);
    const proportion =
      tracks.files / Math.max(1, tracks.files + tracks.history);
    const files = Math.round(remainingHeight * proportion);
    return { git: 38, files, history: remainingHeight - files };
  }
  const gitProportion =
    tracks.git / Math.max(1, tracks.git + tracks.files + tracks.history);
  const git = Math.max(38, Math.round(availableHeight * gitProportion));
  const remainingHeight = Math.max(220, availableHeight - git);
  const filesProportion =
    tracks.files / Math.max(1, tracks.files + tracks.history);
  const files = Math.round(remainingHeight * filesProportion);
  return { git, files, history: remainingHeight - files };
}
