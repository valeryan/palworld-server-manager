import "server-only";
import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import type { WorldOverview } from "@/contracts/world";
import { database, sqliteClient } from "@/server/db";
import { backups, modRuntimes, schedules } from "@/server/db/schema";
import { requireWorld } from "./worlds";

// The Overview tab's state cards, read from the database only: nothing here touches the install
// directory, so the tab can poll it cheaply.
export async function worldOverview(worldId: string): Promise<WorldOverview> {
  await requireWorld(worldId);
  const count = (table: "schedules" | "backups", where: string) => (sqliteClient().prepare(`SELECT count(*) AS count FROM ${table} WHERE world_id=? ${where}`).get(worldId) as { count: number }).count;
  const [nextSchedule] = await database().select({ action: schedules.action, mode: schedules.mode, nextRunAt: schedules.nextRunAt, skipNext: schedules.skipNext }).from(schedules).where(and(eq(schedules.worldId, worldId), eq(schedules.enabled, true), isNotNull(schedules.nextRunAt))).orderBy(asc(schedules.nextRunAt)).limit(1);
  const [latestBackup] = await database().select({ createdAt: backups.createdAt, sizeBytes: backups.sizeBytes, verified: backups.verified, reason: backups.reason }).from(backups).where(eq(backups.worldId, worldId)).orderBy(desc(backups.createdAt)).limit(1);
  const [runtime] = await database().select({ version: modRuntimes.version, enabled: modRuntimes.enabled, earlyCrashes: modRuntimes.earlyCrashes, recoveryPaused: modRuntimes.recoveryPaused }).from(modRuntimes).where(eq(modRuntimes.worldId, worldId)).limit(1);
  return {
    nextSchedule: nextSchedule ? { ...nextSchedule, nextRunAt: nextSchedule.nextRunAt! } : null,
    enabledSchedules: count("schedules", "AND enabled=1"),
    backups: { count: count("backups", ""), latest: latestBackup ?? null },
    modRuntime: runtime ?? null,
  };
}
