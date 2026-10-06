import "server-only";
import type { JobContext } from "../jobs";
import { startProcessMonitor } from "./monitor";
import { startWorldProcess } from "./start";
import { stopWorld, type StopOptions } from "./stop";
import { cancelRecovery, withLifecycleLock } from "./state";

// World server lifecycle: `command` builds the command line, `leases` owns the runtime lease and
// process identities, `start`/`stop` run one transition each, `monitor` reconciles against the
// host and recovers crashes, `state` holds the lifecycle lock and process-wide maps.
export { commandFor, parseArguments } from "./command";
export { reconcileProcesses } from "./monitor";
export { adoptOrphanedServers, adoptRunningServer, assertAdoptable, runningServerTree } from "./adopt";
export { stopWorld };

export async function startWorld(worldId: string): Promise<void> {
  cancelRecovery(worldId);
  await withLifecycleLock(worldId, () => startWorldProcess(worldId));
  startProcessMonitor();
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
