import "server-only";
import { access, chmod, mkdir, rm, stat } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import AdmZip from "adm-zip";
import { asc, eq } from "drizzle-orm";
import { backupSettingsSchema, type BackupSettingsInput } from "@/contracts/backup";
import type { JobContext } from "./jobs";
import { database } from "@/server/db";
import { backupSettings, backups } from "@/server/db/schema";
import { paths } from "@/server/paths";
import { getWorld } from "./worlds";
import { listWorlds, pathsOverlap } from "./worlds";
import { worldIsLocked } from "./jobs";
import { adoptRestoredConfiguration, validateConfiguration } from "./configuration";
import { safeEntries } from "./archive";

function saveDirectory(installDir: string): string { return path.join(installDir, "Pal", "Saved"); }

export async function createBackup(worldId: string, reason: string, context: JobContext): Promise<string> {
  const world = await getWorld(worldId); if (!world) throw new Error("World not found.");
  const source = saveDirectory(world.installDir);
  await stat(source).catch(() => { throw new Error(`Save directory does not exist: ${source}`); });
  await context.update(10, "Collecting save files");
  const id = randomUUID();
  const settings = await getBackupSettings(worldId);
  const directory = settings.destinationDir ?? paths.backups(worldId);
  await mkdir(directory, { recursive: true });
  const destination = path.join(directory, `${Date.now()}-${id}.zip`);
  const zip = new AdmZip(); zip.addLocalFolder(source, "Saved"); zip.writeZip(destination);
  await chmod(destination, 0o600);
  const verified = new AdmZip(destination).test();
  if (!verified) { await rm(destination, { force: true }); throw new Error("Backup verification failed."); }
  const info = await stat(destination);
  await database().insert(backups).values({ id, worldId, filePath: destination, sizeBytes: info.size, reason, verified: true, createdAt: Date.now() });
  await applyRetention(worldId, settings.retentionCount, id, context.log);
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
  const settingsEntry = zip.getEntry(`Saved/Config/${world.platform === "windows" ? "WindowsServer" : "LinuxServer"}/PalWorldSettings.ini`);
  if (!settingsEntry) throw new Error("Backup does not contain PalWorldSettings.ini.");
  const restoredConfiguration = settingsEntry.getData().toString("utf8");
  validateConfiguration(restoredConfiguration);
  await context.update(10, "Creating pre-restore backup");
  await createBackup(worldId, `pre-restore-${backupId}`, { signal: context.signal, update: async () => {}, log: context.log });
  const saved = saveDirectory(world.installDir); const staging = `${saved}.restore-${randomUUID()}`;
  await mkdir(staging, { recursive: true }); zip.extractAllTo(staging, true, false);
  const extracted = path.join(staging, "Saved");
  await stat(extracted).catch(() => { throw new Error("Backup does not contain a Saved directory."); });
  const displaced = `${saved}.before-${Date.now()}`;
  try {
    await adoptRestoredConfiguration(worldId, restoredConfiguration, async () => {
      const { rename } = await import("node:fs/promises");
      await rename(saved, displaced);
      try { await rename(extracted, saved); }
      catch (cause) { await rename(displaced, saved); throw cause; }
      return async () => { await rm(saved, { recursive: true, force: true }); await rename(displaced, saved); };
    });
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  await context.update(100, `Restored backup; previous save retained at ${displaced}`);
}

export async function listBackups(worldId: string) { return database().select().from(backups).where(eq(backups.worldId, worldId)); }

export async function getBackup(worldId: string, backupId: string) {
  const [record] = await database().select().from(backups).where(eq(backups.id, backupId)).limit(1);
  if (!record || record.worldId !== worldId) throw new Error("Backup not found for this world.");
  return record;
}

export async function getBackupSettings(worldId: string) {
  if (!await getWorld(worldId)) throw new Error("World not found.");
  const [record] = await database().select().from(backupSettings).where(eq(backupSettings.worldId, worldId)).limit(1);
  return { destinationDir: record?.destinationDir ?? null, retentionCount: record?.retentionCount ?? 0 } satisfies BackupSettingsInput;
}

async function validateDestination(worldId: string, candidate: string | null): Promise<string | null> {
  if (!candidate) return null;
  if (!path.isAbsolute(candidate)) throw new Error("Custom backup destination must be an absolute path.");
  const destination = path.resolve(candidate);
  for (const world of await listWorlds()) {
    if (pathsOverlap(destination, path.resolve(world.installDir))) {
      throw new Error(`Backup destination overlaps the installation for ${world.displayName}.`);
    }
  }
  const relativeToWorldBackups = path.relative(path.resolve(paths.backups(worldId)), destination);
  const insideWorldBackups = relativeToWorldBackups === "" || (!relativeToWorldBackups.startsWith("..") && !path.isAbsolute(relativeToWorldBackups));
  if (pathsOverlap(destination, path.resolve(paths.data())) && !insideWorldBackups) {
    throw new Error("Custom backup destination cannot overlap other manager-owned data.");
  }
  await mkdir(destination, { recursive: true });
  await access(destination, constants.W_OK);
  return destination;
}

export async function updateBackupSettings(worldId: string, value: unknown) {
  if (!await getWorld(worldId)) throw new Error("World not found.");
  const input = backupSettingsSchema.parse(value);
  const destinationDir = await validateDestination(worldId, input.destinationDir);
  const record = { worldId, destinationDir, retentionCount: input.retentionCount, updatedAt: Date.now() };
  await database().insert(backupSettings).values(record).onConflictDoUpdate({ target: backupSettings.worldId, set: { destinationDir, retentionCount: input.retentionCount, updatedAt: record.updatedAt } });
  return { destinationDir, retentionCount: input.retentionCount } satisfies BackupSettingsInput;
}

export async function deleteBackup(worldId: string, backupId: string): Promise<void> {
  if (worldIsLocked(worldId)) throw new Error("Another operation is already running for this world.");
  const record = await getBackup(worldId, backupId);
  await rm(record.filePath, { force: true });
  await database().delete(backups).where(eq(backups.id, record.id));
}

async function applyRetention(worldId: string, keep: number, protectedId: string, log: (message: string) => void): Promise<void> {
  if (keep <= 0) return;
  const records = await database().select().from(backups).where(eq(backups.worldId, worldId)).orderBy(asc(backups.createdAt));
  const expired = retentionCandidates(records, keep, protectedId);
  for (const record of expired) {
    try {
      await rm(record.filePath, { force: true });
      await database().delete(backups).where(eq(backups.id, record.id));
      log(`Retention removed ${path.basename(record.filePath)}.`);
    } catch (error) {
      log(`Retention could not remove ${path.basename(record.filePath)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export function retentionCandidates<T extends { id: string }>(oldestFirst: readonly T[], keep: number, protectedId: string): T[] {
  if (keep <= 0 || oldestFirst.length <= keep) return [];
  return oldestFirst.filter((record) => record.id !== protectedId).slice(0, oldestFirst.length - keep);
}
