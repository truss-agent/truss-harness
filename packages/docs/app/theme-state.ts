export type Theme = "light" | "dark";

export interface ThemeEnvironment {
  readonly read: () => string | null;
  readonly write: (theme: Theme) => void;
  readonly prefersDark: () => boolean;
  readonly apply: (theme: Theme) => void;
}

export function createThemeStore(environment: ThemeEnvironment) {
  let theme: Theme = "light";
  const listeners = new Set<() => void>();
  const set = (next: Theme) => {
    theme = next;
    environment.apply(theme);
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => theme,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    initialize() {
      let saved: string | null = null;
      try {
        saved = environment.read();
      } catch {
        /* Preferences remain usable without storage. */
      }
      set(
        saved === "light" || saved === "dark"
          ? saved
          : environment.prefersDark()
            ? "dark"
            : "light",
      );
    },
    set,
    toggle() {
      set(theme === "dark" ? "light" : "dark");
      try {
        environment.write(theme);
      } catch {
        /* Retain this document's in-memory preference. */
      }
    },
  };
}
