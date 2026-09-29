import "server-only";
import path from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";
import type { LuaModView } from "@/contracts/mod";
import type { WorldView } from "@/contracts/world";
import { resolveModsDirectory, ue4ssLayout } from "./ue4ss";

export const MANAGED_MARKER = "psm-mod.json";
const MAX_MODS_TXT_BYTES = 256 * 1024;

async function exists(target: string): Promise<boolean> { try { await stat(target); return true; } catch { return false; } }

// mods.txt lines are "ModName : 1|0"; blank lines and ";" comments are ignored.
export function parseModsTxt(content: string): Map<string, boolean> {
  const state = new Map<string, boolean>();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(";")) continue;
    const match = trimmed.match(/^(.+?)\s*:\s*(\d+)$/);
    if (match) state.set(match[1]!.trim(), match[2] !== "0");
  }
  return state;
}

export async function listLuaMods(world: Pick<WorldView, "installDir" | "platform">): Promise<LuaModView[]> {
  const layout = ue4ssLayout(world);
  const directory = await resolveModsDirectory(layout);
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const modsTxt = path.join(directory, "mods.txt");
  const listed = (await stat(modsTxt).then((info) => info.size <= MAX_MODS_TXT_BYTES, () => false))
    ? parseModsTxt(await readFile(modsTxt, "utf8")) : new Map<string, boolean>();
  const mods = await Promise.all(entries.filter((entry) => entry.isDirectory() && !layout.reserved.has(entry.name)).map(async (entry) => {
    const folder = path.join(directory, entry.name);
    const [forced, upperScript, lowerScript, managed] = await Promise.all([
      exists(path.join(folder, "enabled.txt")), exists(path.join(folder, "Scripts", "main.lua")),
      exists(path.join(folder, "scripts", "main.lua")), exists(path.join(folder, MANAGED_MARKER)),
    ]);
    // enabled.txt force-loads a mod regardless of its mods.txt entry.
    const enabledBy: LuaModView["enabledBy"] = forced ? "enabled-txt" : listed.get(entry.name) ? "mods-txt" : null;
    return { name: entry.name, enabled: enabledBy !== null, enabledBy, hasScript: upperScript || lowerScript, managed };
  }));
  return mods.sort((left, right) => left.name.localeCompare(right.name));
}
