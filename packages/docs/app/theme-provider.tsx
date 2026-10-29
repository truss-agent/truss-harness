"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { createThemeStore } from "./theme-state";

const storageKey = "truss-site-theme";
const ThemeContext = createContext<ReturnType<typeof createThemeStore> | null>(
  null,
);

export function ThemeProvider({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [store] = useState(() =>
    createThemeStore({
      read: () => window.localStorage.getItem(storageKey),
      write: (theme) => window.localStorage.setItem(storageKey, theme),
      prefersDark: () =>
        window.matchMedia("(prefers-color-scheme: dark)").matches,
      apply: (theme) => {
        document.documentElement.dataset.trussTheme = theme;
      },
    }),
  );
  useEffect(() => {
    store.initialize();
    const sync = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) store.initialize();
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [store]);
  return (
    <ThemeContext.Provider value={store}>{children}</ThemeContext.Provider>
  );
}

export function useSiteTheme() {
  const store = useContext(ThemeContext);
  if (!store) throw new Error("ThemeToggle requires ThemeProvider");
  const theme = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    () => "light" as const,
  );
  return { theme, toggleTheme: store.toggle };
}
