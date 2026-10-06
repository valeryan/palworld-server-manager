import "server-only";
import { eq } from "drizzle-orm";
import { errorMessage } from "@/lib/errors";
import { database } from "@/server/db";
import { schedules } from "@/server/db/schema";
import { nextRun } from "../schedules";
import { queueSchedule } from "./actions";
import { log } from "./log";

/** Fires every enabled clock-driven schedule whose time has come. */
export async function handleTimedSchedules(now: number): Promise<void> {
  const enabled = await database().select().from(schedules).where(eq(schedules.enabled, true));
  for (const schedule of enabled.filter((item) => item.mode !== "on_join" && item.action !== "idle_stop" && item.nextRunAt != null && item.nextRunAt <= now)) {
    const following = nextRun(schedule, now);
    if (schedule.skipNext) { await database().update(schedules).set({ skipNext: false, nextRunAt: following }).where(eq(schedules.id, schedule.id)); await log(schedule.worldId, "scheduler", `Skipped scheduled ${schedule.action}.`); continue; }
    try {
      if (!await queueSchedule(schedule)) continue;
      await database().update(schedules).set({ lastRunAt: now, nextRunAt: following }).where(eq(schedules.id, schedule.id));
    } catch (error) {
      // Move on to the next scheduled time instead of retrying (and logging) every tick while the world is busy.
      await database().update(schedules).set({ nextRunAt: following }).where(eq(schedules.id, schedule.id));
      await log(schedule.worldId, "scheduler", `Could not queue ${schedule.action}; it will be tried again at the next scheduled time: ${errorMessage(error)}`);
    }
  }
}
