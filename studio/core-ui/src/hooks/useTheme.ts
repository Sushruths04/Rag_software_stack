import { useCallback, useEffect, useState } from "react";

export type ThemeChoice = "dark" | "light";

const STORAGE_KEY = "graft-studio-theme";

function systemPrefersLight(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: light)").matches;
}

function readStored(): ThemeChoice | null {
  if (typeof window === "undefined") return null;
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === "dark" || v === "light" ? v : null;
}

/**
 * Manual dark/light toggle that stamps `data-theme` on <html>, which always
 * wins over `prefers-color-scheme` (04_DESIGN_SYSTEM.md §8.6 rule: "the IDE
 * defaults to dark; both honor OS preference" — this hook is the toggle half
 * of that contract; tokens.css is the media-query half).
 */
export function useTheme(): [ThemeChoice, (t: ThemeChoice) => void, () => void] {
  const [theme, setThemeState] = useState<ThemeChoice>(() => readStored() ?? (systemPrefersLight() ? "light" : "dark"));

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const setTheme = useCallback((t: ThemeChoice) => {
    setThemeState(t);
    window.localStorage.setItem(STORAGE_KEY, t);
  }, []);

  const toggle = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  return [theme, setTheme, toggle];
}
