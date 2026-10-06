import "server-only";

// One promise queue per key, kept on globalThis so a dev-server module reload cannot create a
// second queue and let two pieces of serialized work overlap.
//
// Lock order used across the services, outermost first:
//   job/world lock (jobs.ts) -> lifecycle lock (processes.ts) -> settings:<worldId> -> reservations
// A function holding a later lock must never acquire an earlier one.
declare global { var __psmSerialQueues: Map<string, Promise<unknown>> | undefined; }
const queues = () => (globalThis.__psmSerialQueues ??= new Map<string, Promise<unknown>>());

/** Runs `work` after every earlier call made with the same key has settled. */
export async function serialize<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = queues().get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const marker = previous.catch(() => undefined).then(() => current);
  queues().set(key, marker);
  await previous.catch(() => undefined);
  try { return await work(); }
  finally { release(); if (queues().get(key) === marker) queues().delete(key); }
}
