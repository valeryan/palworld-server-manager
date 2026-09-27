import "server-only";

let reservationQueue: Promise<unknown> = Promise.resolve();

export async function withReservationLock<T>(work: () => Promise<T>): Promise<T> {
  const previous = reservationQueue;
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  reservationQueue = previous.catch(() => undefined).then(() => current);
  await previous.catch(() => undefined);
  try { return await work(); }
  finally { release(); }
}
