import "server-only";
import { eq } from "drizzle-orm";
import { defaultTheme, isThemeId, type ThemeId } from "@/lib/themes";
import { database } from "@/server/db";
import { appSettings } from "@/server/db/schema";

const SETTING_KEY = "appearance-v1";

export async function getTheme(): Promise<ThemeId> {
  const [record] = await database().select().from(appSettings).where(eq(appSettings.key, SETTING_KEY)).limit(1);
  const value = record?.value as { theme?: unknown } | undefined;
  return isThemeId(value?.theme) ? value.theme : defaultTheme;
}

export async function saveTheme(value: unknown): Promise<ThemeId> {
  if (!isThemeId(value)) throw new Error("The selected theme is invalid.");
  await database().insert(appSettings).values({ key: SETTING_KEY, value: { theme: value } }).onConflictDoUpdate({ target: appSettings.key, set: { value: { theme: value } } });
  return value;
}
