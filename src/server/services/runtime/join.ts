import "server-only";
import { and, eq } from "drizzle-orm";
import { errorMessage } from "@/lib/errors";
import { database } from "@/server/db";
import { schedules } from "@/server/db/schema";
import { deliverNotice } from "@/server/mods/relays";
import { startJob } from "../jobs";
import { palworldRest } from "../rest";
import { getWorld } from "../worlds";
import type { ScheduleRow } from "./actions";
import { log } from "./log";
import { presence, type Player } from "./players";

async function deliverJoinSchedule(schedule: ScheduleRow, player: Player): Promise<void> {
  const delay = Math.max(0, schedule.joinDelaySeconds ?? 0);
  if (delay) await new Promise((resolve) => { const timer = setTimeout(resolve, delay * 1_000); timer.unref(); });
  if (!presence().get(schedule.worldId)?.has(player.key)) return;
  const fresh = await database().select().from(schedules).where(eq(schedules.id, schedule.id)).limit(1);
  if (!fresh[0]?.enabled) return;
  try {
    await startJob(schedule.worldId, `scheduled-${schedule.action.replaceAll("_", "-")}`, async () => {
      const world = await getWorld(schedule.worldId); if (!world || world.status !== "running") throw new Error("Server is not running.");
      const message = (schedule.message ?? "").replaceAll(/{player}/gi, player.name);
      if (schedule.action === "onscreen_notice") await deliverNotice(world, message); else await palworldRest.announce(world, message);
    });
    await database().update(schedules).set({ lastRunAt: Date.now() }).where(eq(schedules.id, schedule.id));
  } catch (error) { await log(schedule.worldId, "scheduler", `Could not send join message: ${errorMessage(error)}`); }
}

/** Sends every matching on-join message to a player who just appeared. */
export async function fireJoinSchedules(worldId: string, player: Player): Promise<void> {
  const records = await database().select().from(schedules).where(and(eq(schedules.worldId, worldId), eq(schedules.enabled, true)));
  for (const schedule of records.filter((item) => item.mode === "on_join" && (item.action === "system_message" || item.action === "onscreen_notice"))) {
    if (schedule.joinMatch && schedule.joinMatch.toLocaleLowerCase() !== player.name.toLocaleLowerCase()) continue;
    if (schedule.skipNext) { await database().update(schedules).set({ skipNext: false }).where(eq(schedules.id, schedule.id)); continue; }
    void deliverJoinSchedule(schedule, player).catch((error) => log(schedule.worldId, "scheduler", `Join message failed: ${errorMessage(error)}`).catch(() => undefined));
  }
}
