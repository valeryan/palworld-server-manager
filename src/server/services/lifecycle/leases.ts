import "server-only";
import { rm } from "node:fs/promises";
import { eq } from "drizzle-orm";
import type { WorldView } from "@/contracts/world";
import { database } from "@/server/db";
import { worlds } from "@/server/db/schema";
import { writeFileAtomic } from "@/server/fs";
import { paths } from "@/server/paths";
import { claimLease, readLease, runtimeLeasePath, type RuntimeLease } from "../leases";
import { insideDirectory, ownedTree, processSnapshot, sameProcess, type ProcessIdentity } from "../process-inspection";

// The runtime lease on a world installation and the saved process identities it protects. The
// database row is what the manager trusts; the lease file is what another manager can see.

export async function identities(worldId: string): Promise<ProcessIdentity[]> {
  const [row] = await database().select({ identity: worlds.processIdentity }).from(worlds).where(eq(worlds.id, worldId)); return row?.identity ?? [];
}

export async function persistIdentity(world: WorldView, processes: ProcessIdentity[]): Promise<void> {
  await database().update(worlds).set({ processIdentity: processes }).where(eq(worlds.id, world.id));
  const file = runtimeLeasePath(world.installDir);
  const lease = await readLease<RuntimeLease>(file);
  if (!lease) throw new Error("The installation's runtime lease is missing.");
  if (lease.profile !== paths.data()) throw new Error("This installation belongs to another manager profile.");
  await writeFileAtomic(file, JSON.stringify({ ...lease, processes }), { mode: 0o600 });
}

/** Takes the runtime lease before launching; a stale lease is reclaimed only when its server tree is gone. */
export async function claimInstallation(world: WorldView, snapshot: ProcessIdentity[]): Promise<void> {
  await claimLease<RuntimeLease>(runtimeLeasePath(world.installDir), snapshot, {
    identity: "Cannot establish manager process identity.",
    conflict: "This installation is already owned by a running manager or game server.",
    alsoLive: (lease, current) => ownedTree(lease.processes, current).length > 0,
    payload: (owner) => ({ profile: paths.data(), owner, processes: [] }),
  });
}

export async function releaseInstallation(world: WorldView): Promise<void> {
  const file = runtimeLeasePath(world.installDir);
  const lease = await readLease<RuntimeLease>(file).catch(() => null);
  if (lease?.profile === paths.data()) await rm(file, { force: true });
}

export function belongsToInstall(entry: ProcessIdentity, world: WorldView): boolean {
  return insideDirectory(world.installDir, entry.executable);
}

/** The live, verified server tree for a world; refuses to act on a saved PID another process now holds. */
export async function verifiedProcesses(world: WorldView): Promise<ProcessIdentity[]> {
  const roots = await identities(world.id);
  if (!roots.length && (world.processId || world.status === "unknown")) throw new Error("Cannot verify ownership of this saved PID. Inspect the server process before changing it.");
  const snapshot = await processSnapshot();
  if (roots.some((root) => snapshot.some((row) => row.pid === root.pid && !sameProcess(root, row)))) throw new Error("Saved process identity no longer matches. Refusing to target a reused PID.");
  const live = ownedTree(roots, snapshot);
  if (live.length) await persistIdentity(world, live);
  return live;
}
