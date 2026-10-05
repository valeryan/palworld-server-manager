import "server-only";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import AdmZip from "adm-zip";
import { and, eq } from "drizzle-orm";
import { database } from "@/server/db";
import { modArtifacts } from "@/server/db/schema";
import { NotFoundError } from "@/server/errors";
import { paths } from "@/server/paths";
import { relativeEntry, safeEntries } from "@/server/services/archive";
import { readVerified, sha256Hex } from "./managed-files";

export type LuaArtifact = typeof modArtifacts.$inferSelect;
export const MAX_LUA_ARCHIVE_BYTES = 100 * 1024 * 1024;
const MAX_LUA_UNPACKED_BYTES = 512 * 1024 * 1024;
const MAX_LUA_ENTRIES = 10_000;
// Names UE4SS, Palworld, or the manager own inside a Mods folder.
const RESERVED = new Set(["shared", "bpmodloadermod", "ue4ssstatus", "workshop", "nativemods", "psmdeathrelay", "psmbroadcast"]);
const SCRIPT = /(^|\/)[Ss]cripts\/main\.lua$/;

export interface LuaArchive { name: string; files: Array<{ relative: string; size: number; data: () => Buffer }> }

// One mod per archive, found by its Scripts/main.lua. The folder that holds Scripts names the
// mod; an archive of just Scripts/ is named after the file. enabled.txt is left out so that
// mods.txt stays the only on/off switch the manager edits.
export function readLuaArchive(zip: AdmZip, fileName: string): LuaArchive {
  if (!safeEntries(zip)) throw new Error("The archive contains unsafe paths.");
  const names = zip.getEntries().filter((entry) => !entry.isDirectory).map((entry) => entry.entryName.replaceAll("\\", "/"));
  const roots = [...new Set(names.filter((name) => SCRIPT.test(name)).map((name) => name.replace(SCRIPT, "$1")))];
  if (roots.length === 0) throw new Error("The archive has no Scripts/main.lua, so it is not a UE4SS Lua mod.");
  if (roots.length > 1) throw new Error(`The archive contains ${roots.length} Lua mods; import them one at a time.`);
  const root = roots[0]!;
  const folder = root ? root.replace(/\/$/, "").split("/").at(-1)! : path.basename(fileName).replace(/\.zip$/i, "");
  const name = folder.replace(/[^A-Za-z0-9_.-]/g, "_").replace(/^[._]+/, "").slice(0, 64);
  if (!name) throw new Error("The mod has no usable folder name.");
  if (RESERVED.has(name.toLowerCase())) throw new Error(`"${name}" is reserved by UE4SS, Palworld, or the manager.`);
  const files = zip.getEntries().filter((entry) => !entry.isDirectory).flatMap((entry) => {
    const entryName = entry.entryName.replaceAll("\\", "/");
    if (!entryName.startsWith(root)) return [];
    const relative = relativeEntry(entryName, root);
    return relative.toLowerCase() === "enabled.txt" ? [] : [{ relative, size: entry.header.size, data: () => entry.getData() }];
  });
  if (files.length > MAX_LUA_ENTRIES) throw new Error(`The archive has more than ${MAX_LUA_ENTRIES} files.`);
  if (files.reduce((total, file) => total + file.size, 0) > MAX_LUA_UNPACKED_BYTES) throw new Error("The archive unpacks to more than 512 MiB.");
  return { name, files };
}

export function luaArtifactPath(artifact: Pick<LuaArtifact, "name" | "sha256">): string { return path.join(/* turbopackIgnore: true */ paths.modCache(), "lua", artifact.name, `${artifact.sha256}.zip`); }

export async function listLuaArtifacts(): Promise<LuaArtifact[]> { return database().select().from(modArtifacts).where(eq(modArtifacts.kind, "lua")).orderBy(modArtifacts.name); }
export async function getLuaArtifact(id: string): Promise<LuaArtifact | null> { const [row] = await database().select().from(modArtifacts).where(and(eq(modArtifacts.id, id), eq(modArtifacts.kind, "lua"))).limit(1); return row ?? null; }

export async function importLuaArchive(data: Buffer, fileName: string): Promise<LuaArtifact> {
  if (data.byteLength > MAX_LUA_ARCHIVE_BYTES) throw new Error("The archive is larger than 100 MiB.");
  let zip: AdmZip;
  try { zip = new AdmZip(data); zip.getEntries(); } catch { throw new Error("The file is not a readable zip archive."); }
  const archive = readLuaArchive(zip, fileName);
  const sha256 = sha256Hex(data);
  const [existing] = await database().select().from(modArtifacts).where(and(eq(modArtifacts.kind, "lua"), eq(modArtifacts.name, archive.name))).limit(1);
  const values = { kind: "lua" as const, name: archive.name, fileName: path.basename(fileName), sha256, sizeBytes: data.byteLength, addedAt: Date.now() };
  const destination = luaArtifactPath(values);
  await mkdir(path.dirname(destination), { recursive: true });
  const staging = path.join(/* turbopackIgnore: true */ paths.modStaging(), `${randomUUID()}.part`);
  await writeFile(staging, data); await rename(staging, destination);
  if (existing) {
    if (existing.sha256 !== sha256) await rm(luaArtifactPath(existing), { force: true });
    await database().update(modArtifacts).set(values).where(eq(modArtifacts.id, existing.id));
    return { ...existing, ...values };
  }
  const row = { id: randomUUID(), ...values };
  await database().insert(modArtifacts).values(row);
  return row;
}

export async function loadLuaArtifact(artifact: LuaArtifact): Promise<LuaArchive> {
  const data = await readVerified(luaArtifactPath(artifact), artifact.sha256, { missing: `The library copy of ${artifact.name} is missing; import it again.`, tampered: `The library copy of ${artifact.name} failed verification; import it again.` });
  return readLuaArchive(new AdmZip(data), artifact.fileName);
}

// Removes only the library copy; worlds keep what was installed into them.
export async function removeLuaArtifact(id: string): Promise<void> {
  const artifact = await getLuaArtifact(id); if (!artifact) throw new NotFoundError("Mod library entry not found.");
  await rm(luaArtifactPath(artifact), { force: true });
  await database().delete(modArtifacts).where(eq(modArtifacts.id, id));
}
