import "server-only";
import { ConflictError, HttpError } from "@/server/errors";

// Admission control for world operations. One world has at most one operation or request-time
// change in flight; the drain flag refuses new admissions while the desktop shell is quitting.
// This is the outermost lock in the service lock order (see serialize.ts), so it imports no other
// service.
export const DRAINING = "The manager is quitting; new operations are disabled.";
declare global { var __psmDraining: boolean | undefined; var __psmWorldLocks: Set<string> | undefined; var __psmActiveChanges: number | undefined; }
const locks = () => (globalThis.__psmWorldLocks ??= new Set<string>());

export function worldIsLocked(worldId: string): boolean { return locks().has(worldId); }
export function activeChangeCount(): number { return globalThis.__psmActiveChanges ?? 0; }

/** Refuses admission while draining or while another operation holds the world. */
export function assertAdmission(worldId: string | null): void {
  if (globalThis.__psmDraining) throw new HttpError(DRAINING, 503);
  if (worldId && locks().has(worldId)) throw new ConflictError("Another operation is already running for this world.");
}

/** Takes the world lock after `assertAdmission`; the returned function releases it. */
export function acquireWorldLock(worldId: string): () => void {
  locks().add(worldId);
  return () => { locks().delete(worldId); };
}

/** Counts in-flight request-time changes so a drain can wait for them. */
export async function trackActiveChange<T>(work: () => Promise<T>): Promise<T> {
  globalThis.__psmActiveChanges = (globalThis.__psmActiveChanges ?? 0) + 1;
  try { return await work(); } finally { globalThis.__psmActiveChanges!--; }
}

/**
 * Holds the same per-world lock as operations for a short change made inside a request, so a
 * start or another change cannot begin until it finishes. `claim` optionally takes an on-disk
 * installation lease for the duration and returns its release; jobs.ts wraps this with the lease.
 */
export async function holdWorldLock<T>(worldId: string, task: () => Promise<T>, options: { claim?: () => Promise<() => Promise<void>> } = {}): Promise<T> {
  assertAdmission(worldId);
  const unlock = acquireWorldLock(worldId);
  return trackActiveChange(async () => {
    let release: (() => Promise<void>) | undefined;
    try { release = await options.claim?.(); return await task(); }
    finally {
      try { if (release) await release(); }
      finally { unlock(); }
    }
  });
}
