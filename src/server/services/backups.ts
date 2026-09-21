import "server-only";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import AdmZip from "adm-zip";
import { eq } from "drizzle-orm";
import type { JobContext } from "./jobs";
import { database } from "@/server/db";
import { backups } from "@/server/db/schema";
import { paths } from "@/server/paths";
import { getWorld } from "./worlds";

function saveDirectory(installDir: string): string { return path.join(installDir, "Pal", "Saved"); }
function safeEntries(zip: AdmZip): boolean {
  return zip.getEntries().every((entry) => {
    const normalized = path.posix.normalize(entry.entryName.replaceAll("\\", "/"));
    return normalized !== ".." && !normalized.startsWith("../") && !path.posix.isAbsolute(normalized);
  });
}

export async function createBackup(worldId: string, reason: string, context: JobContext): Promise<string> {
  const world = await getWorld(worldId); if (!world) throw new Error("World not found.");
  const source = saveDirectory(world.installDir);
  await stat(source).catch(() => { throw new Error(`Save directory does not exist: ${source}`); });
  await context.update(10, "Collecting save files");
  const id = randomUUID();
  const destination = path.join(paths.backups(worldId), `${Date.now()}-${id}.zip`);
  const zip = new AdmZip(); zip.addLocalFolder(source, "Saved"); zip.writeZip(destination);
  const verified = new AdmZip(destination).test();
  if (!verified) { await rm(destination, { force: true }); throw new Error("Backup verification failed."); }
  const info = await stat(destination);
  await database().insert(backups).values({ id, worldId, filePath: destination, sizeBytes: info.size, reason, verified: true, createdAt: Date.now() });
  await context.update(100, `Backup verified (${Math.ceil(info.size / 1_048_576)} MiB)`);
  return id;
}

export async function restoreBackup(worldId: string, backupId: string, context: JobContext): Promise<void> {
  const world = await getWorld(worldId); if (!world) throw new Error("World not found.");
  if (world.status !== "stopped" || world.processId) throw new Error("Stop the server before restoring a backup.");
  const [record] = await database().select().from(backups).where(eq(backups.id, backupId)).limit(1);
  if (!record || record.worldId !== worldId) throw new Error("Backup not found for this world.");
  const zip = new AdmZip(record.filePath);
  if (!zip.test() || !safeEntries(zip)) throw new Error("Backup is corrupt or contains unsafe paths.");
  await context.update(10, "Creating pre-restore backup");
  await createBackup(worldId, `pre-restore-${backupId}`, { signal: context.signal, update: async () => {}, log: context.log });
  const saved = saveDirectory(world.installDir); const staging = `${saved}.restore-${randomUUID()}`;
  await mkdir(staging, { recursive: true }); zip.extractAllTo(staging, true, false);
  const extracted = path.join(staging, "Saved");
  await stat(extracted).catch(() => { throw new Error("Backup does not contain a Saved directory."); });
  const displaced = `${saved}.before-${Date.now()}`;
  await import("node:fs/promises").then(async ({ rename }) => { await rename(saved, displaced); await rename(extracted, saved); });
  await rm(staging, { recursive: true, force: true });
  await context.update(100, `Restored backup; previous save retained at ${displaced}`);
}

export async function listBackups(worldId: string) { return database().select().from(backups).where(eq(backups.worldId, worldId)); }
