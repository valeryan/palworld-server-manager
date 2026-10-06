import "server-only";
import { errorMessage } from "@/lib/errors";
import { database } from "@/server/db";
import { events } from "@/server/db/schema";
import type { JobContext } from "../jobs";
import { processSnapshot } from "../process-inspection";
import type { WorldView } from "@/contracts/world";
import { listWorlds } from "../worlds";
import { adoptRunningIfAny, adoptRunningServer, runningServerTree } from "./adopt";
import { startProcessMonitor } from "./monitor";
import { startWorldProcess } from "./start";
import { stopWorld, type StopOptions } from "./stop";
import { cancelRecovery, withLifecycleLock } from "./state";

// World server lifecycle: `command` builds the command line, `leases` owns the runtime lease and
// process identities, `start`/`stop` run one transition each, `monitor` reconciles against the
// host and recovers crashes, `state` holds the lifecycle lock and process-wide maps.
export { commandFor, parseArguments } from "./command";
export { reconcileProcesses } from "./monitor";
export { assertAdoptable, assertAdoptableInstall, runningServerSummary, runningServerTree } from "./adopt";
export { stopWorld };

export async function startWorld(worldId: string): Promise<void> {
  cancelRecovery(worldId);
  await withLifecycleLock(worldId, () => startWorldProcess(worldId));
  startProcessMonitor();
}

/** Adopts a server already running from a newly registered folder and keeps it monitored. */
export async function adoptRegisteredServer(world: WorldView): Promise<boolean> {
  const adopted = await adoptRunningIfAny(world);
  if (adopted) startProcessMonitor();
  return adopted;
}

/** At boot: every stopped world whose installation already runs a server adopts it. */
export async function adoptOrphanedServers(): Promise<void> {
  const candidates = (await listWorlds()).filter((world) => (world.status === "stopped" || world.status === "crashed") && !world.processId);
  if (!candidates.length) return;
  const snapshot = await processSnapshot(); let adopted = false;
  for (const world of candidates) {
    const tree = runningServerTree(world.installDir, snapshot);
    if (!tree.length) continue;
    try { await withLifecycleLock(world.id, () => adoptRunningServer(world, tree, snapshot)); adopted = true; }
    catch (error) { await database().insert(events).values({ worldId: world.id, kind: "lifecycle", message: `A server is running from this installation but could not be adopted: ${errorMessage(error)}`, createdAt: Date.now() }); }
  }
  if (adopted) startProcessMonitor();
}

export async function restartWorld(worldId: string, options: StopOptions = {}): Promise<void> { await stopWorld(worldId, false, options); await startWorld(worldId); }

/** The body of a start/stop/restart operation, shared by the action route and the scheduler. */
export function lifecycleTask(worldId: string, action: "start" | "stop" | "restart", force = false): (job: JobContext) => Promise<void> {
  return async (job) => {
    if (action === "start") { await job.update(10, "Starting server process"); await startWorld(worldId); }
    else if (action === "stop") { await job.update(10, force ? "Force-stopping server process" : "Requesting graceful server shutdown"); await stopWorld(worldId, force); }
    else { await job.update(10, "Stopping server"); await stopWorld(worldId); await job.update(60, "Starting server"); await startWorld(worldId); }
  };
}
