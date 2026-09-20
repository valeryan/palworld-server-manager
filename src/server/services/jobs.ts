import "server-only";
import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { JobView } from "@/contracts/job";
import { database } from "@/server/db";
import { jobs } from "@/server/db/schema";
import { eventBus } from "./events";

export interface JobContext {
  update(progress: number, message: string): Promise<void>;
  log(message: string): void;
}

declare global { var __psmWorldLocks: Set<string> | undefined; }
const locks = () => (globalThis.__psmWorldLocks ??= new Set<string>());

async function publish(id: string): Promise<void> {
  const [job] = await database().select().from(jobs).where(eq(jobs.id, id)).limit(1);
  if (job) eventBus().publish({ type: "job", worldId: job.worldId ?? undefined, data: job });
}

export async function listJobs(limit = 100): Promise<JobView[]> {
  return await database().select().from(jobs).orderBy(desc(jobs.createdAt)).limit(Math.min(limit, 500));
}

export async function startJob(worldId: string | null, kind: string, task: (context: JobContext) => Promise<void>): Promise<string> {
  if (worldId && locks().has(worldId)) throw new Error("Another operation is already running for this world.");
  const id = randomUUID();
  await database().insert(jobs).values({ id, worldId, kind, state: "queued", progress: 0, message: "Queued", createdAt: Date.now() });
  await publish(id);
  if (worldId) locks().add(worldId);
  void (async () => {
    try {
      await database().update(jobs).set({ state: "running", startedAt: Date.now(), message: "Starting" }).where(eq(jobs.id, id));
      await publish(id);
      await task({
        update: async (progress, message) => {
          await database().update(jobs).set({ progress: Math.max(0, Math.min(100, Math.round(progress))), message }).where(eq(jobs.id, id));
          await publish(id);
        },
        log: (message) => eventBus().publish({ type: "log", worldId: worldId ?? undefined, data: { jobId: id, message } }),
      });
      await database().update(jobs).set({ state: "succeeded", progress: 100, message: "Complete", finishedAt: Date.now() }).where(eq(jobs.id, id));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await database().update(jobs).set({ state: "failed", message: "Failed", error: message, finishedAt: Date.now() }).where(eq(jobs.id, id));
    } finally {
      if (worldId) locks().delete(worldId);
      await publish(id);
    }
  })();
  return id;
}

export function worldIsLocked(worldId: string): boolean { return locks().has(worldId); }
