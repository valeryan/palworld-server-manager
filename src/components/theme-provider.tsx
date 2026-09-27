"use client";
import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { defaultTheme, isThemeId, themeStorageKey, type ThemeId } from "@/lib/themes";

type ThemeContextValue = { theme: ThemeId; setTheme(theme: ThemeId): void };
const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyTheme(theme: ThemeId) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = "dark";
}

function currentTheme(): ThemeId {
  const value = document.documentElement.dataset.theme ?? localStorage.getItem(themeStorageKey);
  return isThemeId(value) ? value : defaultTheme;
}

function subscribeTheme(onChange: () => void) {
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== themeStorageKey || !isThemeId(event.newValue)) return;
    applyTheme(event.newValue);
    onChange();
  };
  window.addEventListener("psm-theme-change", onChange);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener("psm-theme-change", onChange);
    window.removeEventListener("storage", handleStorage);
  };
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, () => defaultTheme);

  const value = useMemo<ThemeContextValue>(() => ({
    theme,
    setTheme(nextTheme) {
      applyTheme(nextTheme);
      localStorage.setItem(themeStorageKey, nextTheme);
      window.dispatchEvent(new Event("psm-theme-change"));
    },
  }), [theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used within ThemeProvider");
  return value;
}
