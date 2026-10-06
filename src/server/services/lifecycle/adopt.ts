import "server-only";
import { eq } from "drizzle-orm";
import type { WorldView } from "@/contracts/world";
import { database } from "@/server/db";
import { events, worlds } from "@/server/db/schema";
import { startDeathCapture } from "@/server/mods/relays";
import { ConflictError } from "@/server/errors";
import { writeFileAtomic } from "@/server/fs";
import { paths } from "@/server/paths";
import { managerIdentity, readLease, runtimeLeasePath, type RuntimeLease } from "../leases";
import { insideDirectory, ownedTree, processSnapshot, sameProcess, type ProcessIdentity } from "../process-inspection";
import { setRuntimeState } from "../worlds";
import { withLifecycleLock } from "./state";

// A server that is already running from an installation this manager does not track: typically
// one launched by a previous manager instance whose database was reset. Adopting it records the
// process tree and takes the runtime lease, so the normal monitor and stop paths apply. Callers
// start the process monitor afterwards; this module must not import it (monitor -> start -> here).

/** The process tree running from `installDir`, rooted at the processes whose parents are outside it. */
export function runningServerTree(installDir: string, snapshot: ProcessIdentity[]): ProcessIdentity[] {
  const inside = snapshot.filter((entry) => insideDirectory(installDir, entry.executable));
  const pids = new Set(inside.map((entry) => entry.pid));
  return ownedTree(inside.filter((entry) => !pids.has(entry.parentPid)), snapshot);
}

/** Throws when a live manager of another profile owns the installation's server. */
export async function assertAdoptable(installDir: string, snapshot: ProcessIdentity[]): Promise<void> {
  const lease = await readLease<RuntimeLease>(runtimeLeasePath(installDir)).catch(() => null);
  if (lease && lease.profile !== paths.data() && snapshot.some((row) => sameProcess(lease.owner, row))) throw new ConflictError("A running manager from another profile owns this installation's server; stop it there first.");
}

/** Before registering a folder: refuse one whose running server a live foreign manager owns. */
export async function assertAdoptableInstall(installDir: string): Promise<void> {
  const snapshot = await processSnapshot();
  if (runningServerTree(installDir, snapshot).length) await assertAdoptable(installDir, snapshot);
}

/** The server process already running from `installDir`, for the adopt dialog. */
export async function runningServerSummary(installDir: string): Promise<{ pid: number; executable: string } | null> {
  const [root] = runningServerTree(installDir, await processSnapshot());
  return root ? { pid: root.pid, executable: root.executable } : null;
}

/** Takes over `tree` as the world's server. Callers hold the lifecycle lock. */
export async function adoptRunningServer(world: WorldView, tree: ProcessIdentity[], snapshot: ProcessIdentity[]): Promise<void> {
  await assertAdoptable(world.installDir, snapshot);
  const owner = managerIdentity(snapshot, "Cannot establish manager process identity.");
  const lease: RuntimeLease = { profile: paths.data(), owner, processes: tree };
  await writeFileAtomic(runtimeLeasePath(world.installDir), JSON.stringify(lease), { mode: 0o600 });
  const now = Date.now();
  await database().update(worlds).set({ processIdentity: tree, lastStartedAt: now, updatedAt: now }).where(eq(worlds.id, world.id));
  await database().insert(events).values({ worldId: world.id, kind: "lifecycle", message: `Adopted a server already running from this installation (pid ${tree[0]!.pid}).`, createdAt: now });
  await setRuntimeState(world.id, "running", tree[0]!.pid);
  startDeathCapture(world);
}

/** Adopts whatever server already runs from the world's folder; true when one was adopted. */
export async function adoptRunningIfAny(world: WorldView): Promise<boolean> {
  const snapshot = await processSnapshot();
  const tree = runningServerTree(world.installDir, snapshot);
  if (!tree.length) return false;
  await withLifecycleLock(world.id, () => adoptRunningServer(world, tree, snapshot));
  return true;
}
