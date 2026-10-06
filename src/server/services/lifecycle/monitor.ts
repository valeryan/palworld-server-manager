import "server-only";
import { eq, sql } from "drizzle-orm";
import { worldBusy, type WorldView } from "@/contracts/world";
import { errorMessage } from "@/lib/errors";
import { database } from "@/server/db";
import { events, worlds } from "@/server/db/schema";
import { recordUnexpectedExit } from "@/server/mods/ue4ss-runtime";
import { startDeathCapture, stopDeathCapture } from "@/server/mods/relays";
import { startJob } from "../jobs";
import { ownedTree, processSnapshot, sameProcess, type ProcessIdentity } from "../process-inspection";
import { getWorld, listWorlds, setRuntimeState } from "../worlds";
import { identities, persistIdentity, releaseInstallation } from "./leases";
import { startWorldProcess } from "./start";
import { cancelRecovery, children, recoveryTimers, tryLifecycleLock, withLifecycleLock } from "./state";

// Background reconciliation of registered worlds against the host process table: confirms running
// servers, detects crashes, and schedules crash recovery.

declare global { var __psmProcessTimer: NodeJS.Timeout | undefined; var __psmReconciling: boolean | undefined; var __psmInspectionError: string | undefined; }

export function startProcessMonitor() {
  if (globalThis.__psmProcessTimer) return;
  globalThis.__psmProcessTimer = setInterval(() => {
    if (globalThis.__psmDraining) return;
    void reconcileProcesses().catch((error) => {
      const message = errorMessage(error);
      if (globalThis.__psmInspectionError !== message) { globalThis.__psmInspectionError = message; console.error(`Process reconciliation failed: ${message}`); }
    });
  }, 2_000);
  globalThis.__psmProcessTimer.unref();
}

function scheduleRecovery(world: WorldView): void {
  cancelRecovery(world.id);
  const timer = setTimeout(() => {
    recoveryTimers().delete(world.id);
    if (globalThis.__psmDraining) return;
    startJob(world.id, "crash-recovery", () => withLifecycleLock(world.id, async () => {
      const current = await getWorld(world.id);
      if (!current || current.status !== "crashed" || !current.crashGuard || current.lastStartedAt !== world.lastStartedAt || globalThis.__psmDraining) return;
      await startWorldProcess(world.id);
    })).catch((error) => database().insert(events).values({ worldId: world.id, kind: "lifecycle", message: `Crash recovery could not start: ${errorMessage(error)}`, createdAt: Date.now() }).catch(() => undefined));
  }, 5_000);
  recoveryTimers().set(world.id, timer); timer.unref();
}

async function recordCrash(world: WorldView, roots: ProcessIdentity[], snapshot: ProcessIdentity[]): Promise<void> {
  const reused = roots.some((root) => snapshot.some((entry) => entry.pid === root.pid && !sameProcess(root, entry)));
  if (reused) { await setRuntimeState(world.id, "unknown", world.processId); return; }
  await stopDeathCapture(world).catch(() => undefined); await releaseInstallation(world);
  await database().update(worlds).set({ processIdentity: null }).where(eq(worlds.id, world.id));
  await setRuntimeState(world.id, "crashed", null);
  const pause = await recordUnexpectedExit(world.id, { code: null, uptimeMs: world.lastStartedAt ? Date.now() - world.lastStartedAt : 0 }).catch(() => true);
  if (world.crashGuard && !pause && !globalThis.__psmDraining) {
    await database().update(worlds).set({ crashCount: sql`${worlds.crashCount} + 1` }).where(eq(worlds.id, world.id));
    scheduleRecovery(world);
  }
}

async function reconcileWorld(world: WorldView, snapshot: ProcessIdentity[]): Promise<void> {
  if (world.status === "starting" && !world.processId && children().has(world.id)) return;
  const roots = await identities(world.id);
  if (!roots.length && world.processId) { await setRuntimeState(world.id, "unknown", world.processId); return; }
  const live = ownedTree(roots, snapshot);
  if (live.length) {
    try { await persistIdentity(world, live); } catch { await setRuntimeState(world.id, "unknown", world.processId); return; }
    if (world.status !== "stopping") await setRuntimeState(world.id, "running", live[0]!.pid);
    startDeathCapture(world); return;
  }
  if (world.status === "stopping") return;
  if (world.processId || world.status === "running") await recordCrash(world, roots, snapshot);
}

export async function reconcileProcesses(): Promise<void> {
  if (globalThis.__psmReconciling) return; globalThis.__psmReconciling = true;
  const releases: Array<() => void> = [];
  try {
    const registered: WorldView[] = [];
    for (const candidate of await listWorlds()) {
      const release = tryLifecycleLock(candidate.id);
      if (!release) continue;
      releases.push(release);
      const current = await getWorld(candidate.id);
      if (current) registered.push(current);
    }
    if (!registered.some((world) => worldBusy(world))) return;
    let snapshot: ProcessIdentity[];
    try { snapshot = await processSnapshot(); globalThis.__psmInspectionError = undefined; }
    catch (error) {
      const message = errorMessage(error);
      for (const world of registered) if (world.processId || world.status === "running") await setRuntimeState(world.id, "unknown", world.processId);
      if (globalThis.__psmInspectionError !== message) { globalThis.__psmInspectionError = message; console.error(`Process inspection failed; ownership remains unverified: ${message}`); }
      startProcessMonitor(); return;
    }
    for (const world of registered) await reconcileWorld(world, snapshot);
    startProcessMonitor();
  } finally { for (const release of releases) release(); globalThis.__psmReconciling = false; }
}
