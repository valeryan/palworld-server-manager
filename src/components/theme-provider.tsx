"use client";
import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { requestJson } from "@/lib/http-client";
import { defaultTheme, isThemeId, type ThemeId } from "@/lib/themes";

type ThemeContextValue = { theme: ThemeId; setTheme(theme: ThemeId): Promise<void> };
const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyTheme(theme: ThemeId) {
  document.documentElement.dataset.theme = theme;
}

function currentTheme(): ThemeId {
  const value = document.documentElement.dataset.theme;
  return isThemeId(value) ? value : defaultTheme;
}

function subscribeTheme(onChange: () => void) {
  window.addEventListener("psm-theme-change", onChange);
  return () => window.removeEventListener("psm-theme-change", onChange);
}

async function persistTheme(theme: ThemeId) {
  await requestJson("/api/settings", { method: "PATCH", body: JSON.stringify({ theme }) });
}

export function ThemeProvider({ children, initialTheme }: { children: ReactNode; initialTheme: ThemeId }) {
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, () => initialTheme);

  const setTheme = useCallback(async (nextTheme: ThemeId) => {
    const previousTheme = currentTheme();
    applyTheme(nextTheme);
    window.dispatchEvent(new Event("psm-theme-change"));
    try {
      await persistTheme(nextTheme);
    } catch (error) {
      applyTheme(previousTheme);
      window.dispatchEvent(new Event("psm-theme-change"));
      throw error;
    }
  }, []);

  const value = useMemo<ThemeContextValue>(() => ({
    theme,
    setTheme,
  }), [setTheme, theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used within ThemeProvider");
  return value;
}
