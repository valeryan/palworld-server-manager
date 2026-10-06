import "server-only";
import { eq } from "drizzle-orm";
import killTree from "tree-kill";
import { errorMessage } from "@/lib/errors";
import { database } from "@/server/db";
import { events, worlds } from "@/server/db/schema";
import { hostPlatform } from "@/server/host";
import { recordHealthyExit } from "@/server/mods/ue4ss-runtime";
import { stopDeathCapture } from "@/server/mods/relays";
import { applyDesiredSettings } from "../configuration";
import { processSnapshot, sameProcess } from "../process-inspection";
import { palworldRest } from "../rest";
import { stopWineServer } from "../wine";
import { requireWorld, setRuntimeState } from "../worlds";
import { releaseInstallation, verifiedProcesses } from "./leases";
import { cancelRecovery, delay, withLifecycleLock } from "./state";

export type StopOptions = { waitSeconds?: number; message?: string };

export async function stopWorld(worldId: string, force = false, options: StopOptions = {}): Promise<void> {
  cancelRecovery(worldId);
  return withLifecycleLock(worldId, async () => {
    // Inspection may have scheduled recovery while Stop waited for its snapshot.
    cancelRecovery(worldId);
    await stopWorldProcess(worldId, force, options);
  });
}

/** Graceful REST shutdown when possible, then SIGTERM/SIGKILL escalation over the verified tree. */
async function stopWorldProcess(worldId: string, force: boolean, options: StopOptions): Promise<void> {
  const world = await requireWorld(worldId);
  let live = await verifiedProcesses(world);
  await setRuntimeState(worldId, "stopping", live[0]?.pid ?? null);
  let graceful = false;
  if (live.length && !force && world.restApiEnabled) {
    try { await palworldRest.save(world); await palworldRest.shutdown(world, options.waitSeconds ?? 15, options.message ?? "Server shutting down."); graceful = true; }
    catch (error) { await database().insert(events).values({ worldId, kind: "lifecycle", message: `Graceful shutdown request failed; terminating the process tree instead: ${errorMessage(error)}`, createdAt: Date.now() }); }
  }
  const deadline = Date.now() + (graceful ? ((options.waitSeconds ?? 15) + 10) * 1000 : 0);
  while (live.length && Date.now() < deadline) { await delay(500); live = await verifiedProcesses(world); }
  if (live.length) {
    await database().insert(events).values({ worldId, kind: "lifecycle", message: force ? "Forced termination requested; verifying the owned server process tree has exited." : "Graceful shutdown did not complete; terminating the owned server process tree.", createdAt: Date.now() });
    for (const identity of live.reverse()) {
      const current = (await processSnapshot()).find((row) => sameProcess(identity, row));
      if (!current) continue;
      await new Promise<void>((resolve, reject) => killTree(current.pid, hostPlatform() === "win32" || force ? "SIGKILL" : "SIGTERM", (error) => error && !/no such process/i.test(error.message) ? reject(error) : resolve()));
    }
    const forceAt = Date.now() + 3_000;
    while ((live = await verifiedProcesses(world)).length && Date.now() < forceAt) await delay(250);
    for (const identity of live) {
      if (!(await processSnapshot()).some((row) => sameProcess(identity, row))) continue;
      await new Promise<void>((resolve, reject) => killTree(identity.pid, "SIGKILL", (error) => error ? reject(error) : resolve()));
    }
  }
  await stopWineServer(world, force);
  for (let attempt = 0; attempt < 20 && (await verifiedProcesses(world)).length; attempt++) await delay(250);
  if ((await verifiedProcesses(world)).length) { await setRuntimeState(worldId, "unknown", world.processId); throw new Error("Server processes are still alive; conflicting actions remain blocked."); }
  await stopDeathCapture(world).catch(() => undefined);
  await database().update(worlds).set({ processIdentity: null }).where(eq(worlds.id, worldId));
  await releaseInstallation(world);
  await setRuntimeState(worldId, "stopped", null);
  await recordHealthyExit(worldId).catch(() => undefined);
  const application = await applyDesiredSettings(worldId);
  if (application.pendingApply) throw new Error(`Server stopped; settings remain pending${application.applyError ? `: ${application.applyError}` : "."}`);
}
