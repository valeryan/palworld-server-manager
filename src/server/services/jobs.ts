import "server-only";
import { randomUUID } from "node:crypto";
import { desc, eq, inArray } from "drizzle-orm";
import { EXTERNAL_WORKER_JOB_KINDS, type JobView } from "@/contracts/job";
import type { WorldView } from "@/contracts/world";
import { database, sqliteClient } from "@/server/db";
import { jobLogs, jobs } from "@/server/db/schema";
import { ConflictError, NotFoundError } from "@/server/errors";
import { jobStartingMessage, jobSuccessMessage } from "@/lib/job-presentation";
import { eventBus } from "./events";
import { claimOperationLease, steamCmdProcess } from "./leases";
import { acquireWorldLock, activeChangeCount, assertAdmission, holdWorldLock } from "./locks";
import { processSnapshot } from "./process-inspection";
import { applyOperationRetention } from "./retention";
import { requireWorld } from "./worlds";

export interface JobContext {
  signal: AbortSignal;
  /** Reports progress. `state: "queued"` marks time spent waiting for a shared resource;
   * `preserveOnSuccess` keeps this message as the final one instead of the generic success text. */
  update(progress: number, message: string, options?: { state?: "queued" | "running"; preserveOnSuccess?: boolean }): Promise<void>;
  log(message: string): void;
  nonCancellable?(): void;
}

declare global { var __psmJobControllers: Map<string, AbortController> | undefined; }
const nonCancellable = new Set<string>();
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
  assertAdmission(worldId);
  const id = randomUUID();
  const controller = new AbortController(); controllers().set(id, controller);
  const unlock = worldId ? acquireWorldLock(worldId) : () => undefined;
  try { await database().insert(jobs).values({ id, worldId, kind, state: "queued", progress: 0, message: "Queued", createdAt: Date.now() }); await publish(id); }
  catch (error) { controllers().delete(id); unlock(); throw error; }
  void (async () => {
    let releaseInstallation: (() => Promise<void>) | undefined;
    let finalMessage: string | undefined;
    const log = (message: string) => { sqliteClient().prepare("INSERT INTO job_logs (job_id,message,created_at) VALUES (?,?,?)").run(id, message, Date.now()); };
    try {
      if (worldId) releaseInstallation = await claimOperationLease(await requireWorld(worldId));
      await database().update(jobs).set({ state: "running", startedAt: Date.now(), message: jobStartingMessage(kind) }).where(eq(jobs.id, id));
      await publish(id);
      await task({
        signal: controller.signal,
        nonCancellable: () => { controller.signal.throwIfAborted(); nonCancellable.add(id); },
        update: async (progress, message, options = {}) => {
          if (options.preserveOnSuccess) finalMessage = message;
          await database().update(jobs).set({ state: options.state ?? "running", progress: Math.max(0, Math.min(100, Math.round(progress))), message }).where(eq(jobs.id, id));
          await publish(id);
        },
        log,
      });
      controller.signal.throwIfAborted();
      await database().update(jobs).set({ state: "succeeded", progress: 100, message: finalMessage ?? jobSuccessMessage(kind), finishedAt: Date.now() }).where(eq(jobs.id, id));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(controller.signal.aborted ? "Operation cancelled." : `Operation failed: ${message}`);
      await database().update(jobs).set(controller.signal.aborted ? { state: "cancelled", message: "Cancelled", error: null, finishedAt: Date.now() } : { state: "failed", message: "Failed", error: message, finishedAt: Date.now() }).where(eq(jobs.id, id));
    } finally {
      if (releaseInstallation) await releaseInstallation().catch(() => undefined);
      nonCancellable.delete(id); controllers().delete(id);
      unlock();
      await publish(id);
      await applyOperationRetention().catch(() => undefined);
    }
  })();
  return id;
}

export async function cancelJob(id: string): Promise<void> {
  const [job] = await database().select().from(jobs).where(eq(jobs.id, id)).limit(1);
  if (!job) throw new NotFoundError("Job not found.");
  if (job.state !== "queued" && job.state !== "running") throw new ConflictError("Only queued or running jobs can be cancelled.");
  if (nonCancellable.has(id)) throw new ConflictError("This operation is completing a non-cancellable installer transaction. Wait for Windows to finish.");
  const controller = controllers().get(id);
  if (!controller) throw new ConflictError("This job is no longer attached to the running manager and cannot be cancelled safely.");
  await database().update(jobs).set({ message: "Cancelling" }).where(eq(jobs.id, id));
  await publish(id);
  controller.abort(new Error("Cancelled by user."));
}

/** Holds the world lock and the installation lease for a short change made inside a request. */
export async function withWorldLock<T>(worldId: string, task: () => Promise<T>): Promise<T> {
  return holdWorldLock(worldId, task, { claim: async () => claimOperationLease(await requireWorld(worldId)) });
}
/** `withWorldLock` with the world's current row read under the lock, so it cannot race a start. */
export async function withLockedWorld<T>(worldId: string, task: (world: WorldView) => Promise<T>): Promise<T> {
  let world: WorldView;
  return holdWorldLock(worldId, () => task(world), { claim: async () => { world = await requireWorld(worldId); return claimOperationLease(world); } });
}

export async function listJobLogs(jobId: string, limit = 1_000) {
  return database().select().from(jobLogs).where(eq(jobLogs.jobId, jobId)).orderBy(jobLogs.id).limit(Math.min(Math.max(Math.trunc(limit) || 1_000, 1), 5_000));
}

export function beginDrain(): number { globalThis.__psmDraining = true; return activeOperationCount(); }
export function activeOperationCount(): number { return controllers().size + activeChangeCount(); }

export async function reconcileInterruptedJobs(): Promise<void> {
  const orphaned = await database().select().from(jobs).where(inArray(jobs.state, ["queued", "running"]));
  if (!orphaned.length) return;
  const snapshot = await processSnapshot();
  for (const job of orphaned) {
    if (controllers().has(job.id)) continue;
    const worker = EXTERNAL_WORKER_JOB_KINDS.has(job.kind) && snapshot.some((entry) => steamCmdProcess(entry) || /(?:UEPrereqSetup_x64|vc_redist\.x64)(?:\.exe)?$/i.test(entry.executable));
    if (worker) { if (job.worldId) acquireWorldLock(job.worldId); await database().update(jobs).set({ message: "Interrupted manager; waiting for surviving SteamCMD worker. Restart the manager after it exits before retrying." }).where(eq(jobs.id, job.id)); continue; }
    await database().update(jobs).set({ state: "failed", message: "Interrupted", error: "The previous manager exited before this operation completed. Inspect its output and retry when ready.", finishedAt: Date.now() }).where(eq(jobs.id, job.id));
    await publish(job.id);
  }
}
