import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { database } from "@/server/db";
import { configVersions, events } from "@/server/db/schema";
import { getWorld } from "./worlds";

function configPath(installDir: string, platform: "linux" | "windows") {
  return path.join(installDir, "Pal", "Saved", "Config", platform === "windows" ? "WindowsServer" : "LinuxServer", "PalWorldSettings.ini");
}
function defaultPath(installDir: string) { return path.join(installDir, "DefaultPalWorldSettings.ini"); }
function validate(content: string) {
  if (Buffer.byteLength(content) > 2_000_000) throw new Error("Configuration exceeds the 2 MB safety limit.");
  if (content.includes("\0")) throw new Error("Configuration contains a NUL byte.");
  const match = content.match(/OptionSettings=\((.*)\)/s);
  if (!match) throw new Error("Configuration must contain OptionSettings=(...).");
  let quoted = false; let depth = 0;
  for (const character of match[1] ?? "") {
    if (character === '"') quoted = !quoted;
    else if (!quoted && character === "(") depth += 1;
    else if (!quoted && character === ")") depth -= 1;
    if (depth < 0) throw new Error("OptionSettings contains unbalanced parentheses.");
  }
  if (quoted || depth !== 0) throw new Error("OptionSettings contains unbalanced quotes or parentheses.");
}
async function snapshot(worldId: string, content: string, note: string) {
  await database().insert(configVersions).values({ id: randomUUID(), worldId, fileName: "PalWorldSettings.ini", content, note, createdAt: Date.now() });
}
async function writeAtomic(filePath: string, content: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${randomUUID()}`;
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, filePath);
}

export async function readConfiguration(worldId: string) {
  const world = await getWorld(worldId); if (!world) throw new Error("World not found.");
  const filePath = configPath(world.installDir, world.platform);
  try { return { path: filePath, exists: true, content: await readFile(filePath, "utf8"), running: world.status === "running" }; }
  catch {
    try { return { path: filePath, exists: false, content: await readFile(defaultPath(world.installDir), "utf8"), running: world.status === "running" }; }
    catch { return { path: filePath, exists: false, content: "", running: world.status === "running" }; }
  }
}

export async function saveConfiguration(worldId: string, content: string) {
  validate(content);
  const current = await readConfiguration(worldId);
  if (current.exists && current.content) await snapshot(worldId, current.content, "before edit");
  await writeAtomic(current.path, content);
  await snapshot(worldId, content, "saved");
  await database().insert(events).values({ worldId, kind: "settings", message: "Edited PalWorldSettings.ini (restart to apply)", createdAt: Date.now() });
  return { path: current.path, running: current.running };
}

export async function listConfigurationVersions(worldId: string) {
  const records = await database().select().from(configVersions).where(eq(configVersions.worldId, worldId)).orderBy(desc(configVersions.createdAt)).limit(50);
  return records.map(({ content, ...record }) => ({ ...record, sizeBytes: Buffer.byteLength(content) }));
}

export async function restoreConfiguration(worldId: string, versionId: string) {
  const [version] = await database().select().from(configVersions).where(and(eq(configVersions.id, versionId), eq(configVersions.worldId, worldId))).limit(1);
  if (!version) throw new Error("Configuration version not found.");
  const current = await readConfiguration(worldId);
  if (current.exists && current.content) await snapshot(worldId, current.content, "before restore");
  validate(version.content); await writeAtomic(current.path, version.content); await snapshot(worldId, version.content, `restored from ${versionId}`);
  await database().insert(events).values({ worldId, kind: "settings", message: `Restored PalWorldSettings.ini from ${versionId}`, createdAt: Date.now() });
  return { content: version.content, path: current.path, running: current.running };
}
