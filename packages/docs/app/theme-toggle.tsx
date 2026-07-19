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
    const nextTheme: Theme = savedTheme === "dark" || savedTheme === "light"
      ? savedTheme
      : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

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

  return <button className="site-theme-toggle" type="button" onClick={toggleTheme} aria-label={`Switch to ${nextLabel} mode`} title={`Switch to ${nextLabel} mode`}><span aria-hidden="true">{theme === "dark" ? "Light" : "Dark"}</span></button>;
}
