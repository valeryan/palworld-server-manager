import "server-only";
import path from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";
import type { WorkshopModView, WorkshopStatus } from "@/contracts/mod";
import type { WorldView } from "@/contracts/world";

// Official layout: <install>/Mods/Workshop/<folder>/Info.json, toggled by
// <install>/Mods/PalModSettings.ini (https://docs.palworldgame.com/settings-and-operation/mod/).
const MAX_FILE_BYTES = 256 * 1024;

export interface PalModSettings { exists: boolean; globalEnable: boolean; activeMods: string[]; workshopRootDir: string | null; configVersion: string | null }

async function readSmall(target: string): Promise<string | null> {
  try { const info = await stat(target); return info.isFile() && info.size <= MAX_FILE_BYTES ? await readFile(target, "utf8") : null; } catch { return null; }
}

// Each value is taken from its own line only, so an empty WorkshopRootDir= can
// never swallow the following ConfigVersion line.
export function parsePalModSettings(content: string | null): PalModSettings {
  const settings: PalModSettings = { exists: content !== null, globalEnable: false, activeMods: [], workshopRootDir: null, configVersion: null };
  for (const raw of (content ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";") || line.startsWith("[")) continue;
    const separator = line.indexOf("="); if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase(); const value = line.slice(separator + 1).trim();
    if (key === "bglobalenablemod") settings.globalEnable = /^true$/i.test(value);
    else if (key === "activemodlist") { if (value) settings.activeMods.push(value); }
    else if (key === "workshoprootdir") settings.workshopRootDir = value || null;
    else if (key === "configversion") settings.configVersion = value || null;
  }
  return settings;
}

function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }

// A mod runs on a dedicated server when any InstallRule entry opts in with IsServer.
export function parseInfoJson(content: string): Omit<WorkshopModView, "folder" | "active" | "error"> {
  const info = JSON.parse(content) as Record<string, unknown>;
  const rule = info.InstallRule ?? info.InstallRules ?? [];
  const rules = (Array.isArray(rule) ? rule : [rule]) as Array<Record<string, unknown> | null>;
  return {
    packageName: text(info.PackageName), displayName: text(info.ModName) ?? text(info.PackageName), version: text(info.Version),
    serverCapable: rules.some((entry) => entry?.IsServer === true),
  };
}

export async function workshopStatus(world: Pick<WorldView, "installDir" | "platform">): Promise<WorkshopStatus> {
  const modsRoot = path.join(world.installDir, "Mods");
  const settings = parsePalModSettings(await readSmall(path.join(modsRoot, "PalModSettings.ini")));
  const active = new Set(settings.activeMods);
  const workshop = path.join(modsRoot, "Workshop");
  const entries = await readdir(workshop, { withFileTypes: true }).catch(() => []);
  const mods = (await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry): Promise<WorkshopModView | null> => {
    const content = await readSmall(path.join(workshop, entry.name, "Info.json"));
    if (content === null) return null;
    try { const info = parseInfoJson(content); return { folder: entry.name, ...info, active: Boolean(info.packageName && active.has(info.packageName)), error: null }; }
    catch (error) { return { folder: entry.name, packageName: null, displayName: null, version: null, serverCapable: false, active: false, error: error instanceof Error ? error.message : String(error) }; }
  }))).filter((mod): mod is WorkshopModView => mod !== null).sort((left, right) => left.folder.localeCompare(right.folder));
  return { platformSupported: world.platform === "windows", settingsExists: settings.exists, globalEnable: settings.globalEnable, activeMods: settings.activeMods, mods };
}
