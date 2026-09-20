import "server-only";
import { eq } from "drizzle-orm";
import { database } from "@/server/db";
import { schedules } from "@/server/db/schema";
import { listWorlds } from "./worlds";
import { reconcileProcesses, restartWorld, startWorld } from "./processes";
import { startJob } from "./jobs";
import { createBackup } from "./backups";
import { nextRun } from "./schedules";

declare global { var __psmRuntimeStarted: boolean | undefined; var __psmSchedulerTimer: NodeJS.Timeout | undefined; }

async function schedulerTick() {
  const now = Date.now();
  const due = await database().select().from(schedules).where(eq(schedules.enabled, true));
  for (const schedule of due.filter((item) => (item.action === "backup" || item.action === "restart") && (item.mode === "interval" || item.mode === "daily") && item.nextRunAt != null && item.nextRunAt <= now)) {
    const nextRunAt = nextRun({ mode: schedule.mode as "interval" | "daily", intervalMinutes: schedule.intervalMinutes ?? undefined, timeOfDay: schedule.timeOfDay ?? undefined }, now);
    if (schedule.skipNext) { await database().update(schedules).set({ skipNext: false, nextRunAt }).where(eq(schedules.id, schedule.id)); continue; }
    await database().update(schedules).set({ lastRunAt: now, nextRunAt }).where(eq(schedules.id, schedule.id));
    try {
      if (schedule.action === "backup") await startJob(schedule.worldId, "scheduled-backup", async (context) => { await createBackup(schedule.worldId, "scheduled", context); });
      if (schedule.action === "restart") await startJob(schedule.worldId, "scheduled-restart", async () => { await restartWorld(schedule.worldId); });
    } catch { /* A world-level operation is already active; the next run remains scheduled. */ }
  }
}

export async function startRuntime(): Promise<void> {
  if (globalThis.__psmRuntimeStarted) return;
  globalThis.__psmRuntimeStarted = true;
  await reconcileProcesses();
  for (const world of await listWorlds()) if (world.autostart && world.status !== "running" && world.status !== "starting") await startJob(world.id, "autostart", async () => startWorld(world.id));
  globalThis.__psmSchedulerTimer = setInterval(() => void schedulerTick(), 30_000);
  globalThis.__psmSchedulerTimer.unref();
}
