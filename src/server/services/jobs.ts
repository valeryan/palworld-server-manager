import "server-only";
import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
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
}

declare global { var __psmWorldLocks: Set<string> | undefined; var __psmJobControllers: Map<string, AbortController> | undefined; }
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
  if (worldId && locks().has(worldId)) throw new Error("Another operation is already running for this world.");
  const id = randomUUID();
  await database().insert(jobs).values({ id, worldId, kind, state: "queued", progress: 0, message: "Queued", createdAt: Date.now() });
  await publish(id);
  const controller = new AbortController(); controllers().set(id, controller);
  if (worldId) locks().add(worldId);
  void (async () => {
    try {
      await database().update(jobs).set({ state: "running", startedAt: Date.now(), message: jobStartingMessage(kind) }).where(eq(jobs.id, id));
      await publish(id);
      await task({
        signal: controller.signal,
        update: async (progress, message) => {
          await database().update(jobs).set({ progress: Math.max(0, Math.min(100, Math.round(progress))), message }).where(eq(jobs.id, id));
          await publish(id);
        },
        log: (message) => {
          sqliteClient().prepare("INSERT INTO job_logs (job_id,message,created_at) VALUES (?,?,?)").run(id, message, Date.now());
          eventBus().publish({ type: "log", worldId: worldId ?? undefined, data: { jobId: id, message } });
        },
      });
      controller.signal.throwIfAborted();
      await database().update(jobs).set({ state: "succeeded", progress: 100, message: jobSuccessMessage(kind), finishedAt: Date.now() }).where(eq(jobs.id, id));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await database().update(jobs).set(controller.signal.aborted ? { state: "cancelled", message: "Cancelled", error: null, finishedAt: Date.now() } : { state: "failed", message: "Failed", error: message, finishedAt: Date.now() }).where(eq(jobs.id, id));
    } finally {
      controllers().delete(id);
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
  const controller = controllers().get(id);
  if (!controller) throw new Error("This job is no longer attached to the running manager and cannot be cancelled safely.");
  await database().update(jobs).set({ message: "Cancelling" }).where(eq(jobs.id, id));
  await publish(id);
  controller.abort(new Error("Cancelled by user."));
}

export function worldIsLocked(worldId: string): boolean { return locks().has(worldId); }

export async function listJobLogs(jobId: string, limit = 1_000) {
  return database().select().from(jobLogs).where(eq(jobLogs.jobId, jobId)).orderBy(jobLogs.id).limit(Math.min(Math.max(limit, 1), 5_000));
}
