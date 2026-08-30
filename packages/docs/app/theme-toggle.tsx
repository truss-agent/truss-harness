"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

const storageKey = "truss-site-theme";

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.trussTheme = theme;
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const savedTheme = window.localStorage.getItem(storageKey);
    const nextTheme: Theme =
      savedTheme === "dark" || savedTheme === "light"
        ? savedTheme
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";

    setTheme(nextTheme);
    applyTheme(nextTheme);
  }, []);

  const toggleTheme = (): void => {
    const nextTheme: Theme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    window.localStorage.setItem(storageKey, nextTheme);
    applyTheme(nextTheme);
  };

  const nextLabel = theme === "dark" ? "light" : "dark";

  return (
    <button
      className="site-theme-toggle"
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${nextLabel} mode`}
      title={`Switch to ${nextLabel} mode`}
    >
      {theme === "dark" ? (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20.4 14.5A8.5 8.5 0 0 1 9.5 3.6 8.5 8.5 0 1 0 20.4 14.5Z" />
        </svg>
      )}
    </button>
  );
}
