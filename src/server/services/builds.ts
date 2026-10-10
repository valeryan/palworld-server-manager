import "server-only";
import { buildState, type BuildSummary } from "@/contracts/builds";
import { isJobActive } from "@/contracts/job";
import { ConflictError } from "@/server/errors";
import { readAppSetting } from "@/server/db/app-settings";
import { createBackup } from "./backups";
import { awaitJob, listJobs, startJob, type JobContext } from "./jobs";
import { startWorld, stopWorld } from "./lifecycle";
import { worldIsLocked } from "./locks";
import { warnBeforeShutdown } from "./maintenance";
import { readBuildId } from "./steam-manifest";
import { detectLatestBuild, installOrUpdate, LATEST_BUILD_SETTING, refreshLatestBuild, steamCmdStatus } from "./steamcmd";
import { getWorld, listWorlds, requireWorld } from "./worlds";

// Palworld builds across the fleet: the shared SteamCMD client, one build check for every world,
// and the update-all operation that brings each outdated world to the latest build in turn.

const APP_BUILD_JOB_KINDS = new Set(["update-all", "steamcmd-reinstall"]);
const transitional = (status: string) => status === "starting" || status === "stopping" || status === "unknown";
const latestBuildSetting = (value: unknown) => value && typeof value === "object" && typeof (value as { buildId?: unknown }).buildId === "string" && typeof (value as { checkedAt?: unknown }).checkedAt === "number" ? value as { buildId: string; checkedAt: number } : undefined;

/** Warns players, stops a running world, backs it up, updates it, then restores the prior running state. */
export async function updateWorldWithRestart(worldId: string, context: JobContext, reason: { backup: string; message: string }): Promise<void> {
  const before = await requireWorld(worldId);
  await context.update(2, "Checking the latest Palworld build");
  const latest = await detectLatestBuild(worldId, context.signal).catch((error) => { context.signal.throwIfAborted(); context.log(`Build discovery unavailable; updating anyway: ${(error as Error).message}`); return null; });
  const installed = readBuildId(before);
  if (latest && installed === latest) { await context.update(100, `Already on build ${latest}`, { preserveOnSuccess: true }); return; }
  const wasRunning = before.status === "running";
  if (wasRunning) { const waitSeconds = await warnBeforeShutdown(worldId, "update", context.signal); await stopWorld(worldId, false, { waitSeconds, message: reason.message }); }
  await context.update(10, "Creating safety backup");
  await createBackup(worldId, reason.backup, { signal: context.signal, update: async () => {}, log: context.log });
  let updateError: unknown;
  try { await installOrUpdate(await requireWorld(worldId), context); }
  catch (error) { updateError = error; }
  if (wasRunning) { await context.update(95, "Restoring prior running state"); await startWorld(worldId); }
  if (updateError) throw updateError;
}

export async function buildSummary(): Promise<BuildSummary> {
  const [worlds, steamCmd, latest, recent] = await Promise.all([listWorlds(), steamCmdStatus(), readAppSetting(LATEST_BUILD_SETTING, latestBuildSetting, null), listJobs(50, { app: true })]);
  const activeJob = recent.find((job) => isJobActive(job) && APP_BUILD_JOB_KINDS.has(job.kind));
  return {
    steamCmd, latest,
    worlds: worlds.map((world) => ({ id: world.id, displayName: world.displayName, platform: world.platform, status: world.status, buildId: world.buildId, latestBuildId: world.latestBuildId, state: buildState(world.buildId, world.latestBuildId), busy: worldIsLocked(world.id) || transitional(world.status) })),
    activeJob: activeJob ? { id: activeJob.id, kind: activeJob.kind } : null,
  };
}

/** The update-all operation: one child update job per outdated world, run one at a time. */
export async function updateOutdatedWorlds(context: JobContext): Promise<void> {
  await context.update(2, "Checking the latest Palworld build");
  const latest = await refreshLatestBuild(context.signal);
  const targets = (await listWorlds()).filter((world) => buildState(world.buildId, latest) === "update-available");
  if (!targets.length) { await context.update(100, `Every world is on build ${latest}`, { preserveOnSuccess: true }); return; }
  let updated = 0; let failed = 0; let skipped = 0;
  for (const [index, target] of targets.entries()) {
    context.signal.throwIfAborted();
    const world = await getWorld(target.id);
    if (!world || buildState(world.buildId, latest) !== "update-available") { skipped += 1; continue; }
    if (transitional(world.status) || worldIsLocked(world.id)) { skipped += 1; context.log(`${world.displayName}: skipped (busy)`); continue; }
    await context.update(5 + (90 * index) / targets.length, `Updating ${world.displayName} (${index + 1}/${targets.length})`);
    let childId: string;
    try { childId = await startJob(world.id, "update-restart", (job) => updateWorldWithRestart(world.id, job, { backup: "pre-update-all", message: "Updating to the latest Palworld build." })); }
    catch (error) { if (!(error instanceof ConflictError)) throw error; skipped += 1; context.log(`${world.displayName}: skipped (${error.message})`); continue; }
    const child = await awaitJob(childId, context.signal);
    context.signal.throwIfAborted();
    if (child.state === "succeeded") updated += 1; else failed += 1;
    context.log(`${world.displayName}: ${child.state}${child.error ? ` — ${child.error}` : ""}`);
  }
  if (failed) throw new Error(`${failed} of ${targets.length} world updates failed; see each world's operations.`);
  await context.update(100, `Updated ${updated} world(s); skipped ${skipped}`, { preserveOnSuccess: true });
}
