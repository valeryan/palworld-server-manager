import "server-only";
import { deliverNotice } from "@/server/mods/relays";
import { database } from "@/server/db";
import { events } from "@/server/db/schema";
import { getMaintenanceSettings } from "./schedules";
import { getWorld } from "./worlds";

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, Math.max(0, milliseconds));
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
  });
}

export function warningMessage(template: string, action: string, seconds: number): string {
  return template.replaceAll("{action}", action).replaceAll("{minutes}", String(Math.max(1, Math.ceil(seconds / 60)))).replaceAll("{seconds}", String(seconds));
}

export async function warnBeforeShutdown(worldId: string, action: "restart" | "stop" | "update", signal: AbortSignal): Promise<number> {
  const world = await getWorld(worldId); if (!world) throw new Error("World not found.");
  const settings = await getMaintenanceSettings(worldId);
  if (!settings.warningEnabled || world.status !== "running" || !world.restApiEnabled) return 15;
  const total = settings.warningLeadMinutes * 60;
  const finalWait = Math.min(60, total);
  const step = settings.warningIntervalMinutes > 0 ? settings.warningIntervalMinutes * 60 : total;
  const checkpoints: number[] = [];
  for (let seconds = total; seconds > finalWait; seconds -= step) checkpoints.push(seconds);
  if (!checkpoints.length) checkpoints.push(total);
  let remaining = total;
  for (const seconds of checkpoints) {
    if (remaining > seconds) await wait((remaining - seconds) * 1_000, signal);
    remaining = seconds; signal.throwIfAborted();
    const fresh = await getWorld(worldId); if (!fresh || fresh.status !== "running") return 15;
    const message = warningMessage(settings.warningMessage, action, seconds);
    try {
      // Warnings are shown on screen when PSM Broadcast runs, so players notice them.
      await deliverNotice(fresh, message);
      await database().insert(events).values({ worldId, kind: "warning", message, createdAt: Date.now() });
    } catch (error) {
      await database().insert(events).values({ worldId, kind: "warning", message: `Could not warn players: ${error instanceof Error ? error.message : String(error)}`, createdAt: Date.now() });
    }
  }
  if (remaining > finalWait) await wait((remaining - finalWait) * 1_000, signal);
  return finalWait;
}
