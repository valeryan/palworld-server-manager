import "server-only";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import type { LuaModView } from "@/contracts/mod";
import type { WorldView } from "@/contracts/world";
import { paths } from "@/server/paths";
import { fileMatches, insideFolder, movePath } from "@/server/services/archive";
import { getLuaArtifact, loadLuaArtifact } from "./lua-library";
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

export async function listLuaMods(world: Pick<WorldView, "installDir" | "platform">): Promise<Array<LuaModView & { installedSha256: string | null }>> {
  const layout = ue4ssLayout(world);
  const directory = await resolveModsDirectory(layout);
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const modsTxt = path.join(/* turbopackIgnore: true */ directory, "mods.txt");
  const listed = (await stat(modsTxt).then((info) => info.size <= MAX_MODS_TXT_BYTES, () => false))
    ? parseModsTxt(await readFile(modsTxt, "utf8")) : new Map<string, boolean>();
  const mods = await Promise.all(entries.filter((entry) => entry.isDirectory() && !layout.reserved.has(entry.name)).map(async (entry) => {
    const folder = path.join(/* turbopackIgnore: true */ directory, entry.name);
    const [forced, upperScript, lowerScript, marker] = await Promise.all([
      exists(path.join(/* turbopackIgnore: true */ folder, "enabled.txt")), exists(path.join(/* turbopackIgnore: true */ folder, "Scripts", "main.lua")),
      exists(path.join(/* turbopackIgnore: true */ folder, "scripts", "main.lua")), readMarker(folder),
    ]);
    // enabled.txt force-loads a mod regardless of its mods.txt entry.
    const enabledBy: LuaModView["enabledBy"] = forced ? "enabled-txt" : listed.get(entry.name) ? "mods-txt" : null;
    return { name: entry.name, enabled: enabledBy !== null, active: null, enabledBy, hasScript: upperScript || lowerScript, managed: marker !== null, artifactId: marker?.artifactId ?? null, updateAvailable: false, installedSha256: marker?.sha256 ?? null };
  }));
  return mods.sort((left, right) => left.name.localeCompare(right.name));
}

// Sets or clears one mod's line and leaves every other line (comments, UE4SS's own entries)
// untouched. New entries go before the "Keybinds" entry, which UE4SS requires to stay last.
export function setModsTxtEntry(content: string, name: string, value: boolean | null): string {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content ? content.split(/\r?\n/) : [];
  if (lines.at(-1) === "") lines.pop();
  const matches = (line: string) => line.trim().match(/^(.+?)\s*:\s*\d+$/)?.[1]?.trim() === name;
  const index = lines.findIndex(matches);
  if (value === null) { if (index >= 0) lines.splice(index, 1); }
  else if (index >= 0) lines[index] = `${name} : ${value ? 1 : 0}`;
  else {
    const keybinds = lines.findIndex((line) => /^\s*Keybinds\s*:/.test(line));
    let at = keybinds >= 0 ? keybinds : lines.length;
    while (keybinds >= 0 && at > 0 && lines[at - 1]!.trim().startsWith(";")) at -= 1;
    lines.splice(at, 0, `${name} : ${value ? 1 : 0}`);
  }
  return lines.length ? `${lines.join(newline)}${newline}` : "";
}

type LuaWorld = Pick<WorldView, "id" | "installDir" | "platform" | "status">;
interface ManagedMarker { artifactId: string; name: string; sha256: string; files: string[] }

function assertStopped(world: LuaWorld): void { if (world.status !== "stopped" && world.status !== "crashed") throw new Error("Stop the server before changing Lua mods."); }
function safeName(name: string): string { if (!/^[A-Za-z0-9_.-]{1,64}$/.test(name) || name.startsWith(".")) throw new Error("Invalid mod name."); return name; }

export async function editModsTxt(directory: string, name: string, value: boolean | null): Promise<void> {
  const file = path.join(/* turbopackIgnore: true */ directory, "mods.txt");
  const current = await readFile(file, "utf8").catch(() => "");
  await mkdir(directory, { recursive: true });
  const temporary = `${file}.psm-${randomUUID()}`;
  await writeFile(temporary, setModsTxtEntry(current, name, value)); await rename(temporary, file);
}

async function readMarker(folder: string): Promise<ManagedMarker | null> {
  try { return JSON.parse(await readFile(path.join(/* turbopackIgnore: true */ folder, MANAGED_MARKER), "utf8")) as ManagedMarker; } catch { return null; }
}

// Copies a library mod into the world and turns it on. Updating replaces only the files the
// previous library copy installed, so settings files a mod wrote in the world survive.
export async function installLuaMod(world: LuaWorld, artifactId: string, options: { replace?: boolean } = {}): Promise<void> {
  assertStopped(world);
  const artifact = await getLuaArtifact(artifactId); if (!artifact) throw new Error("Mod library entry not found.");
  const archive = await loadLuaArtifact(artifact);
  const directory = await resolveModsDirectory(ue4ssLayout(world));
  const folder = path.join(/* turbopackIgnore: true */ directory, safeName(archive.name));
  const marker = await readMarker(folder);
  const occupied = await stat(folder).then(() => true, () => false);
  if (occupied && !marker) {
    if (!options.replace) throw new Error(`${archive.name} already exists in this world but was not installed from the Mods library. Use "Replace with library version".`);
    await movePath(folder, path.join(/* turbopackIgnore: true */ paths.modTrash(world.id), `${archive.name}-${Date.now()}`));
  }
  const written = archive.files.map((file) => file.relative);
  for (const stale of (marker?.files ?? []).filter((file) => !written.includes(file))) await rm(insideFolder(folder, stale), { force: true });
  for (const file of archive.files) {
    const target = insideFolder(folder, file.relative);
    await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, file.data());
  }
  const next: ManagedMarker = { artifactId: artifact.id, name: archive.name, sha256: artifact.sha256, files: written };
  await writeFile(path.join(/* turbopackIgnore: true */ folder, MANAGED_MARKER), `${JSON.stringify(next, null, 2)}\n`);
  // A first install turns the mod on; updating or repairing keeps its current on/off choice.
  await editModsTxt(directory, archive.name, marker ? await modsTxtState(directory, archive.name) : true);
}

export async function setLuaModEnabled(world: LuaWorld, name: string, enabled: boolean): Promise<void> {
  assertStopped(world);
  const directory = await resolveModsDirectory(ue4ssLayout(world)); const folder = path.join(/* turbopackIgnore: true */ directory, safeName(name));
  if (!await stat(folder).then((info) => info.isDirectory(), () => false)) throw new Error(`Lua mod ${name} not found.`);
  // enabled.txt loads a mod regardless of mods.txt, so a disabled mod keeps it parked.
  const forced = path.join(/* turbopackIgnore: true */ folder, "enabled.txt");
  if (!enabled && await stat(forced).then(() => true, () => false)) await rename(forced, `${forced}.psm-disabled`);
  await editModsTxt(directory, name, enabled);
}

// Moves the mod's folder to the manager's mod trash and drops its mods.txt line.
export async function removeLuaMod(world: LuaWorld, name: string): Promise<void> {
  assertStopped(world);
  const directory = await resolveModsDirectory(ue4ssLayout(world)); const folder = path.join(/* turbopackIgnore: true */ directory, safeName(name));
  if (!await stat(folder).then((info) => info.isDirectory(), () => false)) throw new Error(`Lua mod ${name} not found.`);
  await movePath(folder, path.join(/* turbopackIgnore: true */ paths.modTrash(world.id), `${name}-${Date.now()}`));
  await editModsTxt(directory, name, null);
}

// Files a library mod installed must still exist and, while that copy is still in the library,
// hold the same bytes as the archive. Files the mod itself created are not checked.
export async function checkLuaModFiles(world: Pick<WorldView, "installDir" | "platform">): Promise<Array<{ name: string; artifactId: string; missing: string[]; changed: string[]; libraryAvailable: boolean }>> {
  const directory = await resolveModsDirectory(ue4ssLayout(world));
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const results = [];
  for (const entry of entries.filter((item) => item.isDirectory())) {
    const folder = path.join(/* turbopackIgnore: true */ directory, entry.name);
    const marker = await readMarker(folder); if (!marker?.artifactId || !Array.isArray(marker.files)) continue;
    const artifact = await getLuaArtifact(marker.artifactId);
    const archive = artifact && artifact.sha256 === marker.sha256 ? await loadLuaArtifact(artifact).catch(() => null) : null;
    const expected = new Map((archive?.files ?? []).map((file) => [file.relative, file]));
    const missing: string[] = []; const changed: string[] = [];
    for (const file of marker.files) {
      const target = path.join(/* turbopackIgnore: true */ folder, ...file.split("/")); const wanted = expected.get(file);
      const matches = wanted ? await fileMatches(target, marker.sha256, wanted) : await exists(target) || null;
      if (matches === null) missing.push(file); else if (!matches) changed.push(file);
    }
    results.push({ name: entry.name, artifactId: marker.artifactId, missing, changed, libraryAvailable: archive !== null });
  }
  return results;
}

export async function modsTxtState(directory: string, name: string): Promise<boolean> {
  return parseModsTxt(await readFile(path.join(/* turbopackIgnore: true */ directory, "mods.txt"), "utf8").catch(() => "")).get(name) === true;
}
