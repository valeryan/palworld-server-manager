import "server-only";
import { and, eq } from "drizzle-orm";
import { database } from "@/server/db";
import { events, schedules, sessions } from "@/server/db/schema";
import { isWorldStopped } from "@/contracts/world";
import { errorMessage } from "@/lib/errors";
import { listWorlds, getWorld, requireWorld } from "./worlds";
import { reconcileProcesses, restartWorld, startWorld, stopWorld } from "./processes";
import { bootstrapWorldSettings } from "./configuration";
import { startJob, reconcileInterruptedJobs, type JobContext } from "./jobs";
import { createBackup, recoverInterruptedRestores } from "./backups";
import { installOrUpdate } from "./steamcmd";
import { nextRun, parseCustomHttp } from "./schedules";
import { palworldRest } from "./rest";
import { deliverNotice } from "@/server/mods/relays";
import { warnBeforeShutdown } from "./maintenance";
import { applyRetentionPolicy } from "./retention";

type ScheduleRow = typeof schedules.$inferSelect;
type Player = { key: string; name: string; userId: string | null };
declare global {
  var __psmRuntimeStarted: boolean | undefined;
  var __psmSchedulerTimer: NodeJS.Timeout | undefined;
  var __psmRuntimeTicking: boolean | undefined;
  var __psmPresence: Map<string, Map<string, Player>> | undefined;
  var __psmLastRetentionAt: number | undefined;
}
const presence = () => (globalThis.__psmPresence ??= new Map<string, Map<string, Player>>());

async function log(worldId: string | null, kind: string, message: string): Promise<void> {
  await database().insert(events).values({ worldId, kind, message, createdAt: Date.now() });
}

function playersFrom(value: unknown): Player[] {
  const list = value && typeof value === "object" && Array.isArray((value as { players?: unknown }).players) ? (value as { players: Array<Record<string, unknown>> }).players : [];
  return list.map((item, index) => {
    const userId = String(item.userId ?? item.userid ?? item.accountName ?? "").trim() || null;
    const name = String(item.name ?? item.playername ?? item.playerName ?? userId ?? `Player ${index + 1}`);
    return { key: userId ?? name.toLocaleLowerCase(), name, userId };
  });
}

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

async function queueSchedule(schedule: ScheduleRow): Promise<boolean> {
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
    } else if (schedule.action === "update") {
      const before = await requireWorld(schedule.worldId);
      const wasRunning = before.status === "running";
      if (wasRunning) { const waitSeconds = await warnBeforeShutdown(schedule.worldId, "update", context.signal); await stopWorld(schedule.worldId, false, { waitSeconds, message: "Scheduled update." }); }
      await safetyBackup(schedule, "pre-scheduled-update", context);
      let updateError: unknown;
      try { await installOrUpdate((await getWorld(schedule.worldId))!, context); }
      catch (error) { updateError = error; }
      if (wasRunning) { await context.update(95, "Restoring prior running state"); await startWorld(schedule.worldId); }
      if (updateError) throw updateError;
    } else if (schedule.action === "system_message" || schedule.action === "onscreen_notice") {
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

async function handleTimedSchedules(now: number): Promise<void> {
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

async function handleIdleSchedules(now: number): Promise<void> {
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

async function fireJoinSchedules(worldId: string, player: Player): Promise<void> {
  const records = await database().select().from(schedules).where(and(eq(schedules.worldId, worldId), eq(schedules.enabled, true)));
  for (const schedule of records.filter((item) => item.mode === "on_join" && (item.action === "system_message" || item.action === "onscreen_notice"))) {
    if (schedule.joinMatch && schedule.joinMatch.toLocaleLowerCase() !== player.name.toLocaleLowerCase()) continue;
    if (schedule.skipNext) { await database().update(schedules).set({ skipNext: false }).where(eq(schedules.id, schedule.id)); continue; }
    void deliverJoinSchedule(schedule, player).catch((error) => log(schedule.worldId, "scheduler", `Join message failed: ${errorMessage(error)}`).catch(() => undefined));
  }
}

async function presenceTick(): Promise<void> {
  for (const world of await listWorlds()) {
    if (world.status !== "running" || !world.restApiEnabled) { presence().delete(world.id); continue; }
    let current: Map<string, Player>;
    try { current = new Map(playersFrom(await palworldRest.players(world)).map((player) => [player.key, player])); } catch { continue; }
    const previous = presence().get(world.id);
    presence().set(world.id, current);
    if (!previous) continue;
    for (const [key, player] of current) if (!previous.has(key)) {
      await database().insert(sessions).values({ worldId: world.id, userId: player.userId, playerName: player.name, event: "join", createdAt: Date.now() });
      await fireJoinSchedules(world.id, player);
    }
    for (const [key, player] of previous) if (!current.has(key)) await database().insert(sessions).values({ worldId: world.id, userId: player.userId, playerName: player.name, event: "leave", createdAt: Date.now() });
  }
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
