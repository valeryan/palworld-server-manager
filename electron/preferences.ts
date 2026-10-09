import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dataDir, isDev, linuxAutostartPath } from "./environment";
import { defaultLaunchAtLoginOptions, normalizeLaunchAtLoginOptions, type LaunchAtLoginOptions } from "./launch-options";

export type DesktopPreferences = { lastLoginExecutable: string | null; closeToTray: boolean; startMinimized: boolean; launchAtLogin: boolean; launchOptions: LaunchAtLoginOptions; lastSuccessfulAppVersion: string | null };

const preferencePath = () => path.join(dataDir(), "desktop-preferences.json");
// Before any preference is saved, launch-at-login follows whether a Linux autostart entry already exists.
// A development run shares the home directory with the installed app but never owns that entry.
const defaultPreferences = (): DesktopPreferences => ({ lastLoginExecutable: null, closeToTray: true, startMinimized: false, launchAtLogin: !isDev && process.platform === "linux" && existsSync(linuxAutostartPath()), launchOptions: defaultLaunchAtLoginOptions, lastSuccessfulAppVersion: null });

export function preferences(): DesktopPreferences {
  const defaults = defaultPreferences();
  try {
    const saved = JSON.parse(readFileSync(preferencePath(), "utf8"));
    return { lastLoginExecutable: typeof saved.lastLoginExecutable === "string" ? saved.lastLoginExecutable : null, closeToTray: saved.closeToTray !== false, startMinimized: saved.startMinimized === true, launchAtLogin: saved.launchAtLogin === true || (saved.launchAtLogin == null && defaults.launchAtLogin), launchOptions: normalizeLaunchAtLoginOptions(saved.launchOptions), lastSuccessfulAppVersion: typeof saved.lastSuccessfulAppVersion === "string" ? saved.lastSuccessfulAppVersion : null };
  } catch { return defaults; }
}
export function writePreferences(patch: Partial<DesktopPreferences>) { atomicWrite(preferencePath(), JSON.stringify({ ...preferences(), ...patch }, null, 2)); }

/** Writes through a sibling temporary file so a crash never leaves a half-written preference or autostart entry. */
export function atomicWrite(filePath: string, content: string) { mkdirSync(path.dirname(filePath), { recursive: true }); const temporary = `${filePath}.tmp-${process.pid}`; writeFileSync(temporary, content, { mode: 0o600 }); renameSync(temporary, filePath); }

