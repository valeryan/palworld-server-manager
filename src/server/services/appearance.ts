import "server-only";
import { defaultTheme, isThemeId, type ThemeId } from "@/lib/themes";
import { readAppSetting, writeAppSetting } from "@/server/db/app-settings";

const SETTING_KEY = "appearance-v1";

export function getTheme(): Promise<ThemeId> {
  return readAppSetting(SETTING_KEY, (value) => { const theme = (value as { theme?: unknown } | null)?.theme; return isThemeId(theme) ? theme : undefined; }, defaultTheme);
}

export async function saveTheme(value: unknown): Promise<ThemeId> {
  if (!isThemeId(value)) throw new Error("The selected theme is invalid.");
  await writeAppSetting(SETTING_KEY, { theme: value });
  return value;
}
