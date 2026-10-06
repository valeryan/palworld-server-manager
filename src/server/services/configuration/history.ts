import "server-only";
import { readFile } from "node:fs/promises";
import { and, desc, eq } from "drizzle-orm";
import { managedWorldSettingsSchema, worldBusy } from "@/contracts/world";
import { validateConfiguration } from "@/lib/palworld-ini";
import { database } from "@/server/db";
import { configVersions } from "@/server/db/schema";
import { ConflictError } from "@/server/errors";
import { withReservationLock } from "../reservations";
import { getWorld, requireWorld } from "../worlds";
import { applyUnlocked } from "./apply";
import { readSettingsState, saveDesiredSettings } from "./desired";
import { configPath, managedWorldChangesFromConfiguration } from "./managed";
import { bootstrapUnlocked, commitApplied, locked, managerFromRow, managerFromWorld, rowUnlocked, state, validateReservations } from "./state";

// Saved versions and the paths that adopt an INI from outside the desired/applied flow: a
// restored version, the file on disk, or a backup's configuration.

export async function listConfigurationVersions(worldId: string) {
  const records = await database().select().from(configVersions).where(eq(configVersions.worldId, worldId)).orderBy(desc(configVersions.createdAt)).limit(50);
  return records.map(({ content, ...record }) => ({ ...record, sizeBytes: Buffer.byteLength(content) }));
}

export async function restoreConfiguration(worldId: string, versionId: string, baseRevision?: number) {
  const [version] = await database().select().from(configVersions).where(and(eq(configVersions.id, versionId), eq(configVersions.worldId, worldId))).limit(1);
  if (!version) throw new Error("Configuration version not found.");
  const current = await readSettingsState(worldId);
  validateConfiguration(version.content);
  const manager = managedWorldSettingsSchema.parse({ ...current.desiredManager, ...managedWorldChangesFromConfiguration(version.content) });
  return { ...(await saveDesiredSettings(worldId, { baseRevision: baseRevision ?? current.desiredRevision, manager, content: version.content, note: `restored from ${versionId}` })), content: version.content };
}

/** Resolves drift: either adopt the file on disk as the new desired and applied state, or rewrite it from the desired state. */
export async function reconcileConfiguration(worldId: string, action: "import-file" | "reapply-desired") {
  return locked(worldId, async () => {
    const row = await bootstrapUnlocked(worldId);
    const world = await requireWorld(worldId);
    if (worldBusy(world)) throw new ConflictError("Stop the world before reconciling its configuration file.");
    if (action === "reapply-desired") return applyUnlocked(worldId, true);
    const previousManager = managerFromRow(row);
    const content = await readFile(configPath(previousManager.installDir, previousManager.platform), "utf8");
    validateConfiguration(content);
    const manager = managedWorldSettingsSchema.parse({ ...previousManager, ...managedWorldChangesFromConfiguration(content) });
    const now = Date.now();
    const revision = row.desiredRevision + 1;
    await withReservationLock(async () => {
      await validateReservations(worldId, manager);
      database().transaction((tx) => commitApplied(tx, worldId, manager, content, revision, now, "imported external file"));
    });
    return state((await rowUnlocked(worldId))!, (await getWorld(worldId))!);
  });
}

/** Adopts the configuration a backup restore put on disk, rolling the filesystem back if the database commit fails. */
export async function adoptRestoredConfiguration(worldId: string, content: string, replaceFilesystem?: () => Promise<() => Promise<void>>) {
  validateConfiguration(content);
  return locked(worldId, async () => {
    const row = await bootstrapUnlocked(worldId);
    const world = await requireWorld(worldId);
    if (worldBusy(world)) throw new ConflictError("Stop the server before restoring a backup.");
    // The backup was restored into the applied world's save tree. Discard any unrelated staged
    // manager projection so the adopted database state points at the filesystem that was actually replaced.
    const manager = managedWorldSettingsSchema.parse({ ...managerFromWorld(world), ...managedWorldChangesFromConfiguration(content) });
    const now = Date.now();
    const revision = row.desiredRevision + 1;
    await withReservationLock(async () => {
      await validateReservations(worldId, manager);
      const rollback = await replaceFilesystem?.();
      try { database().transaction((tx) => commitApplied(tx, worldId, manager, content, revision, now, "adopted from backup restore")); }
      catch (cause) {
        if (rollback) {
          try { await rollback(); }
          catch (rollbackCause) { throw new AggregateError([cause, rollbackCause], "Configuration adoption failed and the previous save tree could not be restored."); }
        }
        throw cause;
      }
    });
    return state((await rowUnlocked(worldId))!, (await getWorld(worldId))!);
  });
}
