import type { DesktopAgentsSnapshot } from "../../shared.js";

/**
 * Marks completed managed-agent runs whose verified file changes have not yet
 * been reflected in the Desktop workspace UI.
 */
export function markChangedAgentRuns(
  snapshot: DesktopAgentsSnapshot,
  reflectedRunIds: Set<string>,
): boolean {
  let changed = false;
  for (const run of snapshot.runs) {
    if (
      run.state !== "completed" ||
      !run.changedFiles.length ||
      reflectedRunIds.has(run.id)
    )
      continue;
    reflectedRunIds.add(run.id);
    changed = true;
  }
  return changed;
}
