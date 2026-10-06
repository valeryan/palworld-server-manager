import "server-only";
import { and, eq } from "drizzle-orm";
import { errorMessage } from "@/lib/errors";
import { database } from "@/server/db";
import { schedules } from "@/server/db/schema";
import { palworldRest } from "../rest";
import { nextRun } from "../schedules";
import { getWorld } from "../worlds";
import { queueSchedule } from "./actions";
import { log } from "./log";
import { playersFrom, type Player } from "./players";

/** Stops a running world once it has been empty for the schedule's idle period; any player resets the timer. */
export async function handleIdleSchedules(now: number): Promise<void> {
  const records = await database().select().from(schedules).where(and(eq(schedules.enabled, true), eq(schedules.action, "idle_stop")));
  for (const schedule of records) {
    const world = await getWorld(schedule.worldId);
    if (!world || world.status !== "running" || !world.restApiEnabled) continue;
    let online: Player[];
    try { online = playersFrom(await palworldRest.players(world)); } catch { continue; }
    const reset = nextRun(schedule, now);
    if (online.length) { if (schedule.nextRunAt !== reset) await database().update(schedules).set({ nextRunAt: reset }).where(eq(schedules.id, schedule.id)); continue; }
    if (schedule.nextRunAt == null) { await database().update(schedules).set({ nextRunAt: reset }).where(eq(schedules.id, schedule.id)); continue; }
    if (schedule.nextRunAt > now) continue;
    if (schedule.skipNext) { await database().update(schedules).set({ skipNext: false, nextRunAt: reset }).where(eq(schedules.id, schedule.id)); continue; }
    try { if (await queueSchedule(schedule)) await database().update(schedules).set({ lastRunAt: now, nextRunAt: reset }).where(eq(schedules.id, schedule.id)); }
    catch (error) {
      await database().update(schedules).set({ nextRunAt: reset }).where(eq(schedules.id, schedule.id));
      await log(schedule.worldId, "scheduler", `Could not queue idle stop; the idle timer was restarted: ${errorMessage(error)}`);
    }
  }
}
