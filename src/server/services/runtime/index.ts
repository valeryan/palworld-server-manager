import "server-only";
import { eq } from "drizzle-orm";
import { isWorldStopped } from "@/contracts/world";
import { errorMessage } from "@/lib/errors";
import { database } from "@/server/db";
import { schedules } from "@/server/db/schema";
import { recoverInterruptedRestores } from "../backups";
import { bootstrapWorldSettings } from "../configuration";
import { reconcileInterruptedJobs, startJob } from "../jobs";
import { adoptOrphanedServers, reconcileProcesses, startWorld } from "../lifecycle";
import { applyRetentionPolicy } from "../retention";
import { nextRun } from "../schedules";
import { listWorlds } from "../worlds";
import { handleIdleSchedules } from "./idle";
import { log } from "./log";
import { presenceTick } from "./presence";
import { handleTimedSchedules } from "./timed";

// The background runtime: boot-time recovery, then a ten-second tick that polls presence and runs
// the idle, timed and retention schedulers. `actions` executes a due schedule, `join` handles
// on-join messages, `players`/`presence` track who is online.

declare global {
  var __psmRuntimeStarted: boolean | undefined;
  var __psmSchedulerTimer: NodeJS.Timeout | undefined;
  var __psmRuntimeTicking: boolean | undefined;
  var __psmLastRetentionAt: number | undefined;
}

export async function runtimeTick(now = Date.now()): Promise<void> {
  if (globalThis.__psmRuntimeTicking || globalThis.__psmDraining) return;
  globalThis.__psmRuntimeTicking = true;
  try {
    await presenceTick(); await handleIdleSchedules(now); await handleTimedSchedules(now);
    if (!globalThis.__psmLastRetentionAt || now - globalThis.__psmLastRetentionAt >= 6 * 60 * 60 * 1_000) {
      await applyRetentionPolicy(undefined, now); globalThis.__psmLastRetentionAt = now;
    }
  }
  finally { globalThis.__psmRuntimeTicking = false; }
}

// Each boot step stands on its own: a failure is recorded as an event and the manager still comes
// up, so one bad world or journal cannot leave the whole application unreachable.
async function bootStep(name: string, work: () => Promise<void>): Promise<void> {
  try { await work(); }
  catch (error) {
    const message = `Startup step "${name}" failed: ${errorMessage(error)}`;
    console.error(message);
    await log(null, "startup", message).catch(() => undefined);
  }
}

export async function startRuntime(): Promise<void> {
  if (globalThis.__psmRuntimeStarted) return;
  globalThis.__psmRuntimeStarted = true;
  await bootStep("restore recovery", recoverInterruptedRestores);
  await bootStep("interrupted operation recovery", reconcileInterruptedJobs);
  await bootStep("settings bootstrap", () => bootstrapWorldSettings());
  await bootStep("process reconciliation", reconcileProcesses);
  await bootStep("running server adoption", adoptOrphanedServers);
  await bootStep("schedule repair", async () => {
    for (const schedule of await database().select().from(schedules)) if (schedule.nextRunAt && schedule.nextRunAt < Date.now()) await database().update(schedules).set({ nextRunAt: nextRun(schedule) }).where(eq(schedules.id, schedule.id));
  });
  await bootStep("autostart", async () => {
    for (const world of await listWorlds()) {
      if (!world.autostart || !isWorldStopped(world)) continue;
      await startJob(world.id, "autostart", async () => startWorld(world.id)).catch((error) => log(world.id, "startup", `Autostart could not be queued: ${errorMessage(error)}`));
    }
  });
  const tick = () => void runtimeTick().catch((error) => log(null, "scheduler", `Runtime tick failed: ${errorMessage(error)}`).catch(() => undefined));
  tick();
  globalThis.__psmSchedulerTimer = setInterval(tick, 10_000);
  globalThis.__psmSchedulerTimer.unref();
}
