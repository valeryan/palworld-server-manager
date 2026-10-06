import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dataDir, linuxAutostartPath } from "./environment";
import { defaultLaunchAtLoginOptions, defaultManagerPort, normalizeLaunchAtLoginOptions, normalizeManagerPort, type LaunchAtLoginOptions } from "./launch-options";

export type ManagerHost = "127.0.0.1" | "0.0.0.0";
export type DesktopPreferences = { lastLoginExecutable: string | null; closeToTray: boolean; launchAtLogin: boolean; launchOptions: LaunchAtLoginOptions; managerPort: number; managerHost: ManagerHost; lastSuccessfulAppVersion: string | null };

const preferencePath = () => path.join(dataDir(), "desktop-preferences.json");
export function normalizeManagerHost(value: unknown): ManagerHost { return value === "0.0.0.0" ? value : "127.0.0.1"; }
// Before any preference is saved, launch-at-login follows whether a Linux autostart entry already exists.
const defaultPreferences = (): DesktopPreferences => ({ lastLoginExecutable: null, closeToTray: true, launchAtLogin: process.platform === "linux" && existsSync(linuxAutostartPath()), launchOptions: defaultLaunchAtLoginOptions, managerPort: defaultManagerPort, managerHost: "127.0.0.1", lastSuccessfulAppVersion: null });

export function preferences(): DesktopPreferences {
  const defaults = defaultPreferences();
  try {
    const saved = JSON.parse(readFileSync(preferencePath(), "utf8"));
    return { lastLoginExecutable: typeof saved.lastLoginExecutable === "string" ? saved.lastLoginExecutable : null, closeToTray: saved.closeToTray !== false, launchAtLogin: saved.launchAtLogin === true || (saved.launchAtLogin == null && defaults.launchAtLogin), launchOptions: normalizeLaunchAtLoginOptions(saved.launchOptions), managerPort: normalizeManagerPort(saved.managerPort), managerHost: normalizeManagerHost(saved.managerHost), lastSuccessfulAppVersion: typeof saved.lastSuccessfulAppVersion === "string" ? saved.lastSuccessfulAppVersion : null };
  } catch { return defaults; }
}
export function writePreferences(patch: Partial<DesktopPreferences>) { atomicWrite(preferencePath(), JSON.stringify({ ...preferences(), ...patch }, null, 2)); }

/** Writes through a sibling temporary file so a crash never leaves a half-written preference or autostart entry. */
export function atomicWrite(filePath: string, content: string) { mkdirSync(path.dirname(filePath), { recursive: true }); const temporary = `${filePath}.tmp-${process.pid}`; writeFileSync(temporary, content, { mode: 0o600 }); renameSync(temporary, filePath); }

/** Whether the web application has authenticated remote access switched on; LAN binding requires it. */
export function remoteAccessEnabled(): boolean { try { return JSON.parse(readFileSync(path.join(dataDir(), "remote-access.json"), "utf8")).enabled === true; } catch { return false; } }
