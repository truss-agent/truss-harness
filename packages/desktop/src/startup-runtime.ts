export type StartupRuntimeResult<T> =
  | { readonly status: "started"; readonly value: T }
  | { readonly status: "recovered"; readonly error: unknown };

/**
 * Starts the persisted runtime without preventing the Desktop shell from
 * opening when its configuration is no longer usable. This is especially
 * important for session-only credentials, which intentionally disappear when
 * the previous Desktop process exits.
 */
export async function recoverStartupRuntime<T>(
  start: () => Promise<T>,
  dispose: () => Promise<void>,
): Promise<StartupRuntimeResult<T>> {
  try {
    return { status: "started", value: await start() };
  } catch (error) {
    try {
      await dispose();
    } catch {
      // Preserve the original startup error and let the shell open Settings.
    }
    return { status: "recovered", error };
  }
}
