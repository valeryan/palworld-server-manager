import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WorldView } from "@/contracts/world";
import { ConflictError } from "@/server/errors";
import { paths } from "@/server/paths";
import { insideDirectory, ownedTree, processSnapshot, sameProcess, type ProcessIdentity } from "./process-inspection";

// On-disk ownership leases. A lease survives manager death, so a stale one is reclaimed only
// after a host process snapshot proves its owner (and whatever it tracked) is gone. The file is
// always created exclusively, so two managers racing for the same lease cannot both succeed.

export interface OwnedLease { owner: ProcessIdentity }
/** Lease on a world installation while its server runs; `processes` is the tracked server tree. */
export interface RuntimeLease extends OwnedLease { profile: string; processes: ProcessIdentity[] }
/** Lease on a world installation while an operation (install, backup, mod change) touches it. */
export interface OperationLease extends OwnedLease { profile: string }

export const runtimeLeasePath = (installDir: string) => path.join(/* turbopackIgnore: true */ installDir, ".psm-runtime-owner.json");
export const operationLeasePath = (installDir: string) => path.join(/* turbopackIgnore: true */ installDir, ".psm-operation-owner.json");

/** A SteamCMD client or one of its helpers, wherever it was started from. */
export function steamCmdProcess(entry: ProcessIdentity): boolean {
  return /steamcmd(?:\.exe)?$/i.test(entry.executable) || insideDirectory(paths.steamCmd(), entry.executable);
}

/** The lease file's content, or null when there is none. A corrupt file is an error, never a free lease. */
export async function readLease<T extends OwnedLease>(file: string): Promise<T | null> {
  try { return JSON.parse(await readFile(file, "utf8")) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

/** This manager process as the snapshot sees it, which is what a lease records as its owner. */
export function managerIdentity(snapshot: ProcessIdentity[], message: string): ProcessIdentity {
  const owner = snapshot.find((row) => row.pid === process.pid);
  if (!owner?.executable) throw new Error(message);
  return owner;
}

export interface ClaimOptions<T extends OwnedLease> {
  /** Error when this process cannot be found in the snapshot. */
  identity: string;
  /** Error when the existing lease is still live. */
  conflict: string;
  /** Beyond the owner itself, what else keeps an existing lease live. */
  alsoLive?(lease: T, snapshot: ProcessIdentity[]): boolean;
  payload(owner: ProcessIdentity): T;
}

/**
 * Takes the lease at `file`. An existing lease is reclaimed only when its owner is absent from
 * `snapshot` and `alsoLive` finds nothing; otherwise the claim fails with a conflict.
 */
export async function claimLease<T extends OwnedLease>(file: string, snapshot: ProcessIdentity[], options: ClaimOptions<T>): Promise<T> {
  const owner = managerIdentity(snapshot, options.identity);
  const existing = await readLease<T>(file);
  if (existing) {
    if (snapshot.some((row) => sameProcess(existing.owner, row)) || options.alsoLive?.(existing, snapshot)) throw new ConflictError(options.conflict);
    await rm(file);
  }
  const lease = options.payload(owner);
  await writeFile(file, JSON.stringify(lease), { flag: "wx", mode: 0o600 });
  return lease;
}

/** Rejects a change to an installation that another manager profile owns through a live lease. */
export async function assertWorldOwnership(world: Pick<WorldView, "installDir">): Promise<void> {
  for (const file of [runtimeLeasePath(world.installDir), operationLeasePath(world.installDir)]) {
    let lease: RuntimeLease | OperationLease | null;
    try { lease = await readLease<RuntimeLease | OperationLease>(file); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOTDIR") continue; throw new ConflictError("Installation ownership record is unreadable; inspect it before making changes."); }
    if (!lease || lease.profile === paths.data()) continue;
    const snapshot = await processSnapshot();
    if (snapshot.some((row) => sameProcess(lease.owner, row)) || ownedTree("processes" in lease ? lease.processes ?? [] : [], snapshot).length) throw new ConflictError("Another manager profile owns this installation; close its operations before making changes here.");
  }
}

/** Claims the operation lease on a world's installation; the returned function releases it. */
export async function claimOperationLease(world: Pick<WorldView, "installDir">): Promise<() => Promise<void>> {
  await assertWorldOwnership(world);
  await mkdir(world.installDir, { recursive: true });
  const file = operationLeasePath(world.installDir);
  await claimLease<OperationLease>(file, await processSnapshot(), {
    identity: "Cannot verify operation ownership.",
    conflict: "An existing operation still owns this installation.",
    alsoLive: (_lease, snapshot) => snapshot.some(steamCmdProcess),
    payload: (owner) => ({ profile: paths.data(), owner }),
  });
  return () => rm(file, { force: true });
}
