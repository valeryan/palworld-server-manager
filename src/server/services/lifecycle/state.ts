import "server-only";
import type { ChildProcess } from "node:child_process";

// Process-wide lifecycle state, kept on globalThis so a dev-server module reload cannot fork it.
// A process snapshot must not overwrite a concurrent start/stop. Jobs have their own admission
// lock; the lifecycle lock also covers background inspection and delayed crash recovery.
declare global {
  var __psmLifecycleLocks: Map<string, Promise<void>> | undefined;
  var __psmRecoveryTimers: Map<string, NodeJS.Timeout> | undefined;
  var __psmChildren: Map<string, ChildProcess> | undefined;
}
const lifecycleLocks = () => (globalThis.__psmLifecycleLocks ??= new Map<string, Promise<void>>());
export const recoveryTimers = () => (globalThis.__psmRecoveryTimers ??= new Map<string, NodeJS.Timeout>());
/** Launcher children this manager spawned and has not yet seen exit. */
export const children = () => (globalThis.__psmChildren ??= new Map<string, ChildProcess>());

/** Takes the lifecycle lock without waiting; null when another lifecycle action holds it. */
export function tryLifecycleLock(worldId: string): (() => void) | null {
  if (lifecycleLocks().has(worldId)) return null;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  lifecycleLocks().set(worldId, pending);
  return () => { lifecycleLocks().delete(worldId); release(); };
}

export async function withLifecycleLock<T>(worldId: string, work: () => Promise<T>): Promise<T> {
  let release: (() => void) | null;
  while (!(release = tryLifecycleLock(worldId))) await lifecycleLocks().get(worldId);
  try { return await work(); } finally { release(); }
}

export function cancelRecovery(worldId: string): void {
  clearTimeout(recoveryTimers().get(worldId)); recoveryTimers().delete(worldId);
}

export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
