import "server-only";
import type { schedules } from "@/server/db/schema";
import { deliverNotice } from "@/server/mods/relays";
import { createBackup } from "../backups";
import { startJob, type JobContext } from "../jobs";
import { restartWorld, stopWorld } from "../lifecycle";
import { warnBeforeShutdown } from "../maintenance";
import { palworldRest } from "../rest";
import { parseCustomHttp } from "../schedules";
import { updateWorldWithRestart } from "../builds";
import { getWorld } from "../worlds";
import { log } from "./log";

// What a schedule does once it is due: each action as an operation on the world's job queue.
export type ScheduleRow = typeof schedules.$inferSelect;

function headersFrom(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of text.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
    const separator = line.indexOf(":");
    if (separator <= 0) throw new Error(`Invalid HTTP header: ${line}`);
    const name = line.slice(0, separator).trim(); const value = line.slice(separator + 1).trim();
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\r\n]/.test(value)) throw new Error(`Invalid HTTP header: ${name}`);
    headers[name] = value;
  }
  return headers;
}

export async function runCustomHttp(schedule: ScheduleRow): Promise<void> {
  const config = parseCustomHttp(schedule.message); if (!config) throw new Error("Custom HTTP schedule is invalid.");
  const response = await fetch(config.url, { method: config.method, headers: headersFrom(config.headers), body: config.method === "GET" ? undefined : config.body || undefined, signal: AbortSignal.timeout(10_000), redirect: "error" });
  await response.body?.cancel();
  if (!response.ok) throw new Error(`Custom request returned HTTP ${response.status}.`);
  const url = new URL(config.url); await log(schedule.worldId, "scheduler", `Custom request ${config.method} ${url.host}${url.pathname} returned ${response.status}.`);
}

async function safetyBackup(schedule: ScheduleRow, reason: string, context: JobContext): Promise<void> {
  await context.update(10, "Creating safety backup");
  await createBackup(schedule.worldId, reason, { signal: context.signal, update: async () => {}, log: context.log });
}

/** Queues the schedule's action as a job; false when the world cannot take it right now. */
export async function queueSchedule(schedule: ScheduleRow): Promise<boolean> {
  const world = await getWorld(schedule.worldId); if (!world) return false;
  if (schedule.action === "backup" && world.status !== "running") return false;
  await startJob(schedule.worldId, `scheduled-${schedule.action.replaceAll("_", "-")}`, async (context) => {
    if (schedule.action === "backup") await createBackup(schedule.worldId, "scheduled", context);
    else if (schedule.action === "restart") {
      if ((await getWorld(schedule.worldId))?.status !== "running") return;
      await safetyBackup(schedule, "pre-scheduled-restart", context);
      const waitSeconds = await warnBeforeShutdown(schedule.worldId, "restart", context.signal);
      await context.update(70, "Restarting server"); await restartWorld(schedule.worldId, { waitSeconds, message: "Scheduled restart." });
    } else if (schedule.action === "stop" || schedule.action === "idle_stop") {
      if ((await getWorld(schedule.worldId))?.status !== "running") return;
      await safetyBackup(schedule, schedule.action === "idle_stop" ? "pre-idle-stop" : "pre-scheduled-stop", context);
      const waitSeconds = await warnBeforeShutdown(schedule.worldId, "stop", context.signal);
      await context.update(70, "Stopping server"); await stopWorld(schedule.worldId, false, { waitSeconds, message: "Scheduled shutdown." });
    } else if (schedule.action === "update") await updateWorldWithRestart(schedule.worldId, context, { backup: "pre-scheduled-update", message: "Scheduled update." });
    else if (schedule.action === "system_message" || schedule.action === "onscreen_notice") {
      const fresh = await getWorld(schedule.worldId); if (!fresh || fresh.status !== "running") throw new Error("Server is not running.");
      if (schedule.action === "onscreen_notice") {
        const route = await deliverNotice(fresh, schedule.message ?? "");
        await log(schedule.worldId, "scheduler", route === "broadcast" ? "Showed scheduled on-screen notice through PSM Broadcast." : "Sent scheduled notice as a chat message because PSM Broadcast is not running.");
      } else {
        await palworldRest.announce(fresh, schedule.message ?? "");
        await log(schedule.worldId, "scheduler", "Sent scheduled system message.");
      }
    } else if (schedule.action === "custom_http") await runCustomHttp(schedule);
  });
  return true;
}
