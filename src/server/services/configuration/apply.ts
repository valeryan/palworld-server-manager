import "server-only";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { worldBusy, type WorldView } from "@/contracts/world";
import { validateConfiguration } from "@/lib/palworld-ini";
import { database } from "@/server/db";
import { events, worlds, worldSettings } from "@/server/db/schema";
import { ConflictError } from "@/server/errors";
import { readOptional, writeFileAtomic } from "@/server/fs";
import { privateFile } from "@/server/host";
import { getWorld, requireWorld } from "../worlds";
import { configPath, semanticHash } from "./managed";
import { bootstrapUnlocked, locked, managerFromRow, markFailure, projection, rowUnlocked, state } from "./state";

// Writing the desired configuration to PalWorldSettings.ini, with drift detection against what
// is on disk. Only runs while the world is stopped.

async function writeAtomic(filePath: string, content: string) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await writeFileAtomic(filePath, content, { mode: 0o600 });
  await privateFile(filePath);
}

export async function applyUnlocked(worldId: string, force = false) {
  const row = await bootstrapUnlocked(worldId);
  const world = await requireWorld(worldId);
  // Ownership marked unknown is treated as live: the file is never rewritten under a server that may still be running.
  if (worldBusy(world, { includeUnknown: true })) return state(row, world);
  const manager = managerFromRow(row);
  const failApply = async (message: string) => {
    await markFailure(worldId, message, true);
    return state((await rowUnlocked(worldId))!, world);
  };
  try {
    validateConfiguration(row.desiredContent);
    const currentPath = configPath(world.installDir, world.platform);
    const targetPath = configPath(manager.installDir, manager.platform);
    const disk = await readOptional(currentPath);
    let diskHash: string | null = null;
    if (disk?.trim() && !force) {
      try { diskHash = semanticHash(disk); }
      catch { return failApply("PalWorldSettings.ini is malformed. Import a valid file or reapply desired settings before starting."); }
    }
    const desiredHash = semanticHash(row.desiredContent);
    if (!force && row.drift) return state(row, world);
    if (!force && row.appliedSemanticHash && diskHash !== row.appliedSemanticHash && diskHash !== desiredHash) return failApply("PalWorldSettings.ini was changed outside the manager or removed. Import it or reapply desired settings before starting.");
    if (!force && path.resolve(/* turbopackIgnore: true */ targetPath) !== path.resolve(/* turbopackIgnore: true */ currentPath)) {
      const targetDisk = await readOptional(targetPath);
      if (targetDisk?.trim()) {
        let targetHash: string;
        try { targetHash = semanticHash(targetDisk); }
        catch { return failApply("The destination PalWorldSettings.ini is malformed. Remove it or explicitly reapply desired settings before moving this world."); }
        if (targetHash !== desiredHash) return failApply("The destination already contains a different PalWorldSettings.ini. Import it or explicitly reapply desired settings before moving this world.");
      }
    }
    if (row.desiredRevision === row.appliedRevision && !row.drift) return state(row, world);
    await writeAtomic(targetPath, row.desiredContent);
    const verified = await readFile(targetPath, "utf8");
    if (semanticHash(verified) !== semanticHash(row.desiredContent)) throw new Error("Configuration readback did not match the desired option values.");
    const now = Date.now();
    const hash = semanticHash(verified);
    database().transaction((tx) => {
      tx.update(worlds).set({ ...projection(manager), adminPassword: "", serverPassword: "", updatedAt: now }).where(eq(worlds.id, worldId)).run();
      tx.update(worldSettings).set({
        appliedContent: verified, appliedRevision: row.desiredRevision, managerAppliedRevision: row.desiredRevision, appliedSemanticHash: hash,
        pendingSince: null, lastApplyError: null, drift: false, driftReason: null, appliedAt: now, updatedAt: now,
      }).where(eq(worldSettings.worldId, worldId)).run();
      tx.insert(events).values({ worldId, kind: "settings", message: `Applied settings revision ${row.desiredRevision}`, createdAt: now }).run();
    });
    return state((await rowUnlocked(worldId))!, (await getWorld(worldId))!);
  } catch (cause) {
    await markFailure(worldId, cause instanceof Error ? cause.message : String(cause), row.drift || force);
    return state((await rowUnlocked(worldId))!, world);
  }
}

export async function applyDesiredSettings(worldId: string, options: { force?: boolean } = {}) {
  return locked(worldId, () => applyUnlocked(worldId, options.force));
}

/** Applies pending settings and hands a stopped world to `claim` under the settings lock, so a start cannot race a save. */
export async function prepareWorldStart<T>(worldId: string, claim: (world: WorldView) => Promise<T>) {
  return locked(worldId, async () => {
    const application = await applyUnlocked(worldId);
    if (application.pendingApply) throw new Error(`Server start blocked because settings could not be applied${application.applyError ? `: ${application.applyError}` : "."}`);
    const world = await requireWorld(worldId);
    if (worldBusy(world)) throw new ConflictError("World is already running or changing state.");
    return claim(world);
  });
}
