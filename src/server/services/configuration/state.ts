import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { managedWorldSettingsSchema, pickManaged, worldBusy, type ManagedWorldSettings, type WorldView } from "@/contracts/world";
import { applyConfigurationOptions, configurationIsValid, validateConfiguration } from "@/lib/palworld-ini";
import { database } from "@/server/db";
import { configVersions, worlds, worldSettings } from "@/server/db/schema";
import { ConflictError } from "@/server/errors";
import { readOptional } from "@/server/fs";
import { assertSupportedTarget } from "@/server/host";
import { serialize } from "@/server/serialize";
import { assertWorldOwnership } from "../leases";
import { trackActiveChange } from "../locks";
import { assertReservationsFree, listWorlds, requireWorld, toWorldColumns } from "../worlds";
import { configPath, defaultConfigurationPath, legacyCredentialChanges, semanticHash } from "./managed";

// The desired/applied settings row: its lock, its bootstrap from disk, and the primitives every
// write path shares. Nothing here touches PalWorldSettings.ini except to read it the first time.

export class StaleSettingsRevisionError extends ConflictError {
  constructor() { super("Settings changed since this page was loaded. Refresh and try again."); }
}

export type Transaction = Parameters<Parameters<ReturnType<typeof database>["transaction"]>[0]>[0];
export type SettingsRow = typeof worldSettings.$inferSelect;

/** Per-world settings lock. It is not re-entrant: nothing inside `work` may call another locked
 * function for the same world (that includes the REST client, which reads credentials under it). */
export async function locked<T>(worldId: string, work: () => Promise<T>): Promise<T> {
  return trackActiveChange(() => serialize(`settings:${worldId}`, work));
}

export function managerFromWorld(world: WorldView): ManagedWorldSettings { return managedWorldSettingsSchema.parse(pickManaged(world)); }
export function managerFromRow(row: SettingsRow) { return managedWorldSettingsSchema.parse(row.desiredManager); }
/** The managed settings as `worlds` columns. */
export function projection(manager: ManagedWorldSettings) { return toWorldColumns(manager, "legacy"); }

export async function validateReservations(worldId: string, candidate: ManagedWorldSettings) {
  assertSupportedTarget(candidate.platform);
  await assertWorldOwnership(candidate);
  await assertReservationsFree(candidate, worldId);
}

/** Records a configuration that is on disk and in effect: desired and applied both move to `revision`. */
export function commitApplied(tx: Transaction, worldId: string, manager: ManagedWorldSettings, content: string, revision: number, now: number, note: string) {
  tx.update(worlds).set({ ...projection(manager), adminPassword: "", serverPassword: "", updatedAt: now }).where(eq(worlds.id, worldId)).run();
  tx.update(worldSettings).set({
    desiredManager: manager, desiredContent: content, appliedContent: content,
    desiredRevision: revision, appliedRevision: revision, managerAppliedRevision: revision,
    appliedSemanticHash: semanticHash(content), pendingSince: null, lastApplyError: null, drift: false, driftReason: null,
    updatedAt: now, appliedAt: now,
  }).where(eq(worldSettings.worldId, worldId)).run();
  tx.insert(configVersions).values({ id: randomUUID(), worldId, fileName: "PalWorldSettings.ini", content, note, createdAt: now }).run();
}

export async function markFailure(worldId: string, message: string, drift = false) {
  await database().update(worldSettings).set({ lastApplyError: message, drift, driftReason: drift ? message : null, pendingSince: Date.now(), updatedAt: Date.now() }).where(eq(worldSettings.worldId, worldId));
}

export async function bootstrapUnlocked(worldId: string): Promise<SettingsRow> {
  const [existing] = await database().select().from(worldSettings).where(eq(worldSettings.worldId, worldId)).limit(1);
  if (existing) return existing;
  const world = await requireWorld(worldId);
  const manager = managerFromWorld(world);
  const active = await readOptional(configPath(world.installDir, world.platform));
  const activeHasContent = Boolean(active?.trim());
  const template = !activeHasContent ? await readOptional(defaultConfigurationPath(world.installDir)) : null;
  const now = Date.now();
  let desired = activeHasContent ? active! : template ?? "";
  const applied = activeHasContent ? active! : "";
  let hash: string | null = null;
  let pending = !activeHasContent;
  let drift = false;
  let error: string | null = null;
  try {
    if (activeHasContent) hash = semanticHash(active!);
    if (desired) {
      validateConfiguration(desired);
      const changes = legacyCredentialChanges(desired, world);
      if (Object.keys(changes).length) { desired = applyConfigurationOptions(desired, changes); pending = true; }
    }
  } catch (cause) {
    drift = true; pending = true;
    error = `Existing PalWorldSettings.ini is malformed: ${cause instanceof Error ? cause.message : String(cause)}`;
    desired = activeHasContent ? active! : template ?? "";
  }
  if (!desired) { drift = true; pending = true; error = "PalWorldSettings.ini and its shipped template are unavailable."; }
  database().transaction((tx) => {
    tx.insert(worldSettings).values({
      worldId, desiredManager: manager, desiredContent: desired, appliedContent: applied,
      desiredRevision: 1, appliedRevision: pending ? 0 : 1, managerAppliedRevision: pending ? 0 : 1,
      appliedSemanticHash: hash, pendingSince: pending ? now : null, lastApplyError: error, drift, driftReason: drift ? error : null,
      updatedAt: now, appliedAt: pending ? null : now,
    }).onConflictDoNothing().run();
    if (!drift) tx.update(worlds).set({ adminPassword: "", serverPassword: "" }).where(eq(worlds.id, worldId)).run();
  });
  const [created] = await database().select().from(worldSettings).where(eq(worldSettings.worldId, worldId)).limit(1);
  if (!created) throw new Error("Failed to initialize world settings.");
  return created;
}

export async function bootstrapWorldSettings(worldId?: string) {
  if (worldId) { await locked(worldId, () => bootstrapUnlocked(worldId)); return; }
  for (const world of await listWorlds()) await locked(world.id, () => bootstrapUnlocked(world.id));
}
export async function rowFor(worldId: string) { return locked(worldId, () => bootstrapUnlocked(worldId)); }
export async function rowUnlocked(worldId: string) {
  const [row] = await database().select().from(worldSettings).where(eq(worldSettings.worldId, worldId)).limit(1);
  return row;
}

export function state(row: SettingsRow, world: WorldView) {
  const pendingApply = row.desiredRevision !== row.appliedRevision || row.drift;
  return {
    desiredRevision: row.desiredRevision, appliedRevision: row.appliedRevision, managerAppliedRevision: row.managerAppliedRevision,
    configurationAvailable: configurationIsValid(row.desiredContent),
    pendingApply, requiresRestart: pendingApply && worldBusy(world),
    drift: row.drift, driftReason: row.driftReason, applyError: row.lastApplyError,
  };
}
export type SettingsState = ReturnType<typeof state>;
