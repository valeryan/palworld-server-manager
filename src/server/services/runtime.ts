import "server-only";
import { eq } from "drizzle-orm";
import { database } from "@/server/db";
import { schedules } from "@/server/db/schema";
import { listWorlds } from "./worlds";
import { reconcileProcesses, startWorld } from "./processes";
import { startJob } from "./jobs";
import { createBackup } from "./backups";

declare global { var __psmRuntimeStarted: boolean | undefined; var __psmSchedulerTimer: NodeJS.Timeout | undefined; }

async function schedulerTick() {
  const now = Date.now();
  const due = await database().select().from(schedules).where(eq(schedules.enabled, true));
  for (const schedule of due.filter((item) => item.nextRunAt != null && item.nextRunAt <= now)) {
    const nextRunAt = schedule.intervalMinutes ? now + schedule.intervalMinutes * 60_000 : now + 86_400_000;
    if (schedule.skipNext) { await database().update(schedules).set({ skipNext: false, nextRunAt }).where(eq(schedules.id, schedule.id)); continue; }
    await database().update(schedules).set({ lastRunAt: now, nextRunAt }).where(eq(schedules.id, schedule.id));
    if (schedule.action === "backup") await startJob(schedule.worldId, "scheduled-backup", async (context) => { await createBackup(schedule.worldId, "scheduled", context); });
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
