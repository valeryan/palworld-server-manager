import "server-only";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { paths } from "@/server/paths";
import { randomUUID } from "node:crypto";
import { desc, eq, inArray } from "drizzle-orm";
import type { JobView } from "@/contracts/job";
import { database, sqliteClient } from "@/server/db";
import { jobLogs, jobs } from "@/server/db/schema";
import { eventBus } from "./events";
import { jobStartingMessage, jobSuccessMessage } from "@/lib/job-presentation";
import { applyOperationRetention } from "./retention";

export interface JobContext {
  signal: AbortSignal;
  update(progress: number, message: string): Promise<void>;
  log(message: string): void;
  nonCancellable?(): void;
}

declare global { var __psmDraining: boolean | undefined; var __psmWorldLocks: Set<string> | undefined; var __psmJobControllers: Map<string, AbortController> | undefined; var __psmActiveChanges: number | undefined; }
const nonCancellable = new Set<string>();
const locks = () => (globalThis.__psmWorldLocks ??= new Set<string>());
const controllers = () => (globalThis.__psmJobControllers ??= new Map<string, AbortController>());

async function publish(id: string): Promise<void> {
  const [job] = await database().select().from(jobs).where(eq(jobs.id, id)).limit(1);
  if (job) eventBus().publish({ type: "job", worldId: job.worldId ?? undefined, data: job });
}

export async function listJobs(limit = 100): Promise<JobView[]> {
  return await database().select().from(jobs).orderBy(desc(jobs.createdAt)).limit(Math.min(Math.max(Math.trunc(limit) || 100, 1), 10_000));
}

export function jobHistoryCounts(): { total: number; active: number; failed: number } {
  return sqliteClient().prepare(`SELECT count(*) AS total,
    coalesce(sum(CASE WHEN state IN ('queued','running') THEN 1 ELSE 0 END),0) AS active,
    coalesce(sum(CASE WHEN state='failed' THEN 1 ELSE 0 END),0) AS failed FROM jobs`).get() as { total: number; active: number; failed: number };
}

export async function getJob(id: string): Promise<JobView | undefined> {
  const [job] = await database().select().from(jobs).where(eq(jobs.id, id)).limit(1);
  return job;
}

export async function startJob(worldId: string | null, kind: string, task: (context: JobContext) => Promise<void>): Promise<string> {
  if (globalThis.__psmDraining) throw new Error("The manager is quitting; new operations are disabled.");
  if (worldId && locks().has(worldId)) throw new Error("Another operation is already running for this world.");
  const id = randomUUID();
  const controller = new AbortController(); controllers().set(id, controller);
  if (worldId) locks().add(worldId);
  try { await database().insert(jobs).values({ id, worldId, kind, state: "queued", progress: 0, message: "Queued", createdAt: Date.now() }); await publish(id); }
  catch (error) { controllers().delete(id); if (worldId) locks().delete(worldId); throw error; }
  void (async () => {
    let releaseInstallation: (() => Promise<void>) | undefined;
    const log = (message: string) => {
      sqliteClient().prepare("INSERT INTO job_logs (job_id,message,created_at) VALUES (?,?,?)").run(id, message, Date.now());
      eventBus().publish({ type: "log", worldId: worldId ?? undefined, data: { jobId: id, message } });
    };
    try {
      if (worldId) releaseInstallation = await claimOperationInstallation(worldId);
      await database().update(jobs).set({ state: "running", startedAt: Date.now(), message: jobStartingMessage(kind) }).where(eq(jobs.id, id));
      await publish(id);
      await task({
        signal: controller.signal,
        nonCancellable: () => { controller.signal.throwIfAborted(); nonCancellable.add(id); },
        update: async (progress, message) => {
          await database().update(jobs).set({ state: message === "Waiting for shared SteamCMD client" ? "queued" : "running", progress: Math.max(0, Math.min(100, Math.round(progress))), message }).where(eq(jobs.id, id));
          await publish(id);
        },
        log,
      });
      controller.signal.throwIfAborted();
      const final = await getJob(id);
      await database().update(jobs).set({ state: "succeeded", progress: 100, message: final?.message.includes("restart required") ? final.message : jobSuccessMessage(kind), finishedAt: Date.now() }).where(eq(jobs.id, id));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(controller.signal.aborted ? "Operation cancelled." : `Operation failed: ${message}`);
      await database().update(jobs).set(controller.signal.aborted ? { state: "cancelled", message: "Cancelled", error: null, finishedAt: Date.now() } : { state: "failed", message: "Failed", error: message, finishedAt: Date.now() }).where(eq(jobs.id, id));
    } finally {
      if (releaseInstallation) await releaseInstallation().catch(() => undefined);
      nonCancellable.delete(id); controllers().delete(id);
      if (worldId) locks().delete(worldId);
      await publish(id);
      await applyOperationRetention().catch(() => undefined);
    }
  })();
  return id;
}

export async function cancelJob(id: string): Promise<void> {
  const [job] = await database().select().from(jobs).where(eq(jobs.id, id)).limit(1);
  if (!job) throw new Error("Job not found.");
  if (job.state !== "queued" && job.state !== "running") throw new Error("Only queued or running jobs can be cancelled.");
  if (nonCancellable.has(id)) throw new Error("This operation is completing a non-cancellable installer transaction. Wait for Windows to finish.");
  const controller = controllers().get(id);
  if (!controller) throw new Error("This job is no longer attached to the running manager and cannot be cancelled safely.");
  await database().update(jobs).set({ message: "Cancelling" }).where(eq(jobs.id, id));
  await publish(id);
  controller.abort(new Error("Cancelled by user."));
}

export function worldIsLocked(worldId: string): boolean { return locks().has(worldId); }

// Holds the same per-world lock as operations for a short change made inside a request, so a
// start or another change cannot begin until it finishes.
export async function withWorldLock<T>(worldId: string, task: () => Promise<T>): Promise<T> {
  if (globalThis.__psmDraining) throw new Error("The manager is quitting; new changes are disabled.");
  if (locks().has(worldId)) throw new Error("Another operation is already running for this world.");
  locks().add(worldId);
  globalThis.__psmActiveChanges = (globalThis.__psmActiveChanges ?? 0) + 1;
  let release: (() => Promise<void>) | undefined;
  try { release = await claimOperationInstallation(worldId); return await task(); }
  finally {
    try { if (release) await release(); }
    finally { locks().delete(worldId); globalThis.__psmActiveChanges!--; }
  }
}

export async function listJobLogs(jobId: string, limit = 1_000) {
  return database().select().from(jobLogs).where(eq(jobLogs.jobId, jobId)).orderBy(jobLogs.id).limit(Math.min(Math.max(limit, 1), 5_000));
}

export function beginDrain(): number { globalThis.__psmDraining = true; return activeOperationCount(); }
export function activeOperationCount(): number { return controllers().size + (globalThis.__psmActiveChanges ?? 0); }
// Called after request admission, including by already-running jobs during drain.
export async function trackActiveChange<T>(work: () => Promise<T>): Promise<T> {
  globalThis.__psmActiveChanges = (globalThis.__psmActiveChanges ?? 0) + 1;
  try { return await work(); } finally { globalThis.__psmActiveChanges!--; }
}
export async function reconcileInterruptedJobs(): Promise<void> {
  const orphaned = await database().select().from(jobs).where(inArray(jobs.state, ["queued", "running"]));
  if (!orphaned.length) return;
  const { processSnapshot } = await import("./process-inspection");
  const snapshot = await processSnapshot();
  for (const job of orphaned) {
    if (controllers().has(job.id)) continue;
    const worker = /install|update|prerequisites/.test(job.kind) && snapshot.some((entry) => /(?:steamcmd|UEPrereqSetup_x64|vc_redist\.x64)(?:\.exe)?$/i.test(entry.executable));
    if (worker) { if (job.worldId) locks().add(job.worldId); await database().update(jobs).set({ message: "Interrupted manager; waiting for surviving SteamCMD worker. Restart the manager after it exits before retrying." }).where(eq(jobs.id, job.id)); continue; }
    await database().update(jobs).set({ state: "failed", message: "Interrupted", error: "The previous manager exited before this operation completed. Inspect its output and retry when ready.", finishedAt: Date.now() }).where(eq(jobs.id, job.id));
    await publish(job.id);
  }
}

async function claimOperationInstallation(worldId: string): Promise<() => Promise<void>> {
  const { getWorld, assertWorldOwnership } = await import("./worlds"); const world = await getWorld(worldId); if (!world) throw new Error("World not found.");
  await assertWorldOwnership(world);
  await mkdir(world.installDir, { recursive: true });
  const file = path.join(/* turbopackIgnore: true */ world.installDir, ".psm-operation-owner.json");
  const { processSnapshot, sameProcess } = await import("./process-inspection");
  const snapshot = await processSnapshot(); const owner = snapshot.find((row) => row.pid === process.pid);
  if (!owner) throw new Error("Cannot verify operation ownership.");
  try {
    const old = JSON.parse(await readFile(file, "utf8"));
    if (snapshot.some((row) => sameProcess(old.owner, row) || /steamcmd(?:\.exe)?$/i.test(row.executable))) throw new Error("An existing operation still owns this installation.");
    await rm(file);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  await writeFile(file, JSON.stringify({ profile: paths.data(), owner }), { flag: "wx", mode: 0o600 });
  return () => rm(file, { force: true });
}
