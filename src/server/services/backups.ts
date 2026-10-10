import { privateFile } from "@/server/host";
import "server-only";
import { access, mkdir, rm, stat, writeFile, readFile, rename, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import AdmZip from "adm-zip";
import { asc, eq } from "drizzle-orm";
import { backupSettingsSchema, type BackupSettingsInput } from "@/contracts/backup";
import type { JobContext } from "./jobs";
import { database } from "@/server/db";
import { backupSettings, backups, worldSettings } from "@/server/db/schema";
import { paths } from "@/server/paths";
import { NotFoundError } from "@/server/errors";
import { assertWorldStopped, canonicalInstallDir, getWorld, listWorlds, pathsOverlap, requireWorld } from "./worlds";
import { worldIsLocked } from "./locks";
import { validateConfiguration } from "@/lib/palworld-ini";
import { adoptRestoredConfiguration } from "./configuration";
import { safeEntries } from "./archive";
import { palworldRest } from "./rest";

// Palworld keeps its own rolling backups (bIsUseBackupSaveData) under SaveGames/<user>/<world>/backup.
// Archiving them again would nest backups inside backups, so manager archives leave them out.
const PALWORLD_ROLLING_BACKUP = /^Saved\/SaveGames\/[^/]+\/[^/]+\/backup(?:\/|$)/;
function saveDirectory(installDir: string): string { return path.join(/* turbopackIgnore: true */ installDir, "Pal", "Saved"); }

export async function createBackup(worldId: string, reason: string, context: JobContext): Promise<string> {
  const world = await requireWorld(worldId);
  const source = saveDirectory(world.installDir);
  await stat(source).catch(() => { throw new Error(`Save directory does not exist: ${source}`); });
  // A running server holds recent progress in memory; ask it to write the save first so the archive is current.
  if (world.status === "running" && world.restApiEnabled) {
    await context.update(5, "Saving world");
    try { await palworldRest.save(world); } catch (error) { context.log(`Could not save the world before backing up; archiving the last save on disk: ${(error as Error).message}`); }
  }
  await context.update(10, "Collecting save files");
  const id = randomUUID();
  const settings = await getBackupSettings(worldId);
  const directory = await validateDestination(worldId, settings.destinationDir) ?? paths.backups(worldId);
  await mkdir(directory, { recursive: true });
  const destination = path.join(/* turbopackIgnore: true */ directory, `${Date.now()}-${id}.zip`);
  const zip = new AdmZip(); zip.addLocalFolder(source, "Saved", (relative) => !PALWORLD_ROLLING_BACKUP.test(relative.split(path.sep).join("/"))); zip.writeZip(destination);
  await privateFile(destination);
  const verified = new AdmZip(destination).test();
  if (!verified) { await rm(destination, { force: true }); throw new Error("Backup verification failed."); }
  const info = await stat(destination);
  await database().insert(backups).values({ id, worldId, filePath: destination, sizeBytes: info.size, reason, verified: true, createdAt: Date.now() });
  await applyRetention(worldId, settings.retentionCount, id, context.log);
  await context.update(100, `Backup verified (${Math.ceil(info.size / 1_048_576)} MiB)`);
  return id;
}

// Windows refuses to rename a directory while an antivirus scan or the indexer still holds a file
// inside it. The hold lasts a moment, so retry briefly before giving up.
async function renameRetrying(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try { await rename(from, to); return; }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!["EPERM", "EACCES", "EBUSY"].includes(code ?? "") || attempt >= 50) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

export async function restoreBackup(worldId: string, backupId: string, context: JobContext): Promise<void> {
  const world = await requireWorld(worldId);
  assertWorldStopped(world, "Stop the server before restoring a backup.");
  const [record] = await database().select().from(backups).where(eq(backups.id, backupId)).limit(1);
  if (!record || record.worldId !== worldId) throw new NotFoundError("Backup not found for this world.");
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
  const extracted = path.join(/* turbopackIgnore: true */ staging, "Saved");
  await stat(extracted).catch(() => { throw new Error("Backup does not contain a Saved directory."); });
  context.signal.throwIfAborted();
  context.nonCancellable?.();
  const displaced = `${saved}.before-${Date.now()}`;
  const journal = path.join(/* turbopackIgnore: true */ paths.data(), `restore-${worldId}.json`);
  await writeFile(journal, JSON.stringify({ worldId, saved, staging, displaced }), { flag: "wx", mode: 0o600 });
  try {
    await adoptRestoredConfiguration(worldId, restoredConfiguration, async () => {
      await renameRetrying(saved, displaced);
      try { await renameRetrying(extracted, saved); }
      catch (cause) { await renameRetrying(displaced, saved); throw cause; }
      return async () => { await rm(saved, { recursive: true, force: true }); await renameRetrying(displaced, saved); };
    });
    await rm(journal);
  } catch (error) {
    // Only a failed rollback leaves the save tree displaced; the journal then stays for startup recovery.
    if (!(error instanceof AggregateError)) await rm(journal, { force: true });
    throw error;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  await context.update(100, `Restored backup; previous save retained at ${displaced}`);
}

export async function listBackups(worldId: string) { return database().select().from(backups).where(eq(backups.worldId, worldId)); }

export async function getBackup(worldId: string, backupId: string) {
  const [record] = await database().select().from(backups).where(eq(backups.id, backupId)).limit(1);
  if (!record || record.worldId !== worldId) throw new NotFoundError("Backup not found for this world.");
  return record;
}

export async function getBackupSettings(worldId: string) {
  await requireWorld(worldId);
  const [record] = await database().select().from(backupSettings).where(eq(backupSettings.worldId, worldId)).limit(1);
  return { destinationDir: record?.destinationDir ?? null, retentionCount: record?.retentionCount ?? 0 } satisfies BackupSettingsInput;
}

async function validateDestination(worldId: string, candidate: string | null): Promise<string | null> {
  if (!candidate) return null;
  if (!path.isAbsolute(candidate)) throw new Error("Custom backup destination must be an absolute path.");
  const destination = await canonicalInstallDir(candidate);
  for (const world of await listWorlds()) {
    if (pathsOverlap(destination, await canonicalInstallDir(world.installDir))) {
      throw new Error(`Backup destination overlaps the installation for ${world.displayName}.`);
    }
  }
  const relativeToWorldBackups = path.relative(path.resolve(/* turbopackIgnore: true */ paths.backups(worldId)), destination);
  const insideWorldBackups = relativeToWorldBackups === "" || (!relativeToWorldBackups.startsWith("..") && !path.isAbsolute(relativeToWorldBackups));
  if (pathsOverlap(destination, path.resolve(/* turbopackIgnore: true */ paths.data())) && !insideWorldBackups) {
    throw new Error("Custom backup destination cannot overlap other manager-owned data.");
  }
  await mkdir(destination, { recursive: true });
  await access(destination, constants.W_OK);
  return destination;
}

export async function updateBackupSettings(worldId: string, value: unknown) {
  await requireWorld(worldId);
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

// Restore the old Saved tree after an interrupted replacement. Retain both copies, and require
// explicit configuration reconciliation instead of guessing which database transaction committed.
export async function recoverInterruptedRestores(): Promise<void> {
  for (const name of await readdir(paths.data())) {
    if (!/^restore-[a-f0-9-]+\.json$/.test(name)) continue;
    const journal = path.join(/* turbopackIgnore: true */ paths.data(), name);
    const record = JSON.parse(await readFile(journal, "utf8")) as { worldId: string; saved: string; staging: string; displaced: string };
    const world = await getWorld(record.worldId); if (!world) throw new Error(`Restore recovery requires the missing registration ${record.worldId}.`);
    const expected = saveDirectory(world.installDir);
    if (record.saved !== expected || !record.displaced.startsWith(`${expected}.before-`) || path.dirname(record.displaced) !== path.dirname(expected)) throw new Error("Invalid restore recovery journal; inspect the manager logs.");
    if (await stat(record.displaced).catch(() => null)) {
      if (await stat(expected).catch(() => null)) await renameRetrying(expected, `${expected}.interrupted-${randomUUID()}`);
      await renameRetrying(record.displaced, expected);
      await database().update(worldSettings).set({ drift: true, driftReason: "An interrupted restore was rolled back. Import the recovered configuration before starting.", lastApplyError: "Interrupted restore recovered; configuration reconciliation required." }).where(eq(worldSettings.worldId, world.id));
    }
    await rm(journal);
  }
}
