import "server-only";
import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, createWriteStream, openSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { database } from "@/server/db";
import { worlds } from "@/server/db/schema";
import { applyUe4ssLaunch, recordUnexpectedExit } from "@/server/mods/ue4ss-runtime";
import { resetBroadcastQueue, startDeathCapture } from "@/server/mods/relays";
import { paths } from "@/server/paths";
import { prepareWorldStart, syncManagedConfiguration } from "../configuration";
import { inspectInstallation } from "../installation";
import { inspectPrerequisites } from "../prerequisites";
import { ownedTree, processSnapshot, sameProcess, type ProcessIdentity } from "../process-inspection";
import { prepareWinePrefix } from "../wine";
import { getWorld, setRuntimeState } from "../worlds";
import { commandFor, executableAvailable } from "./command";
import { belongsToInstall, claimInstallation, identities, persistIdentity, releaseInstallation } from "./leases";
import { adoptRunningServer, runningServerTree } from "./adopt";
import { children, delay } from "./state";

/** Launches a world's server. Callers hold the lifecycle lock. */
export async function startWorldProcess(worldId: string): Promise<void> {
  const candidate = await getWorld(worldId);
  if (candidate && (await inspectInstallation(candidate.installDir, candidate.platform)).canInitialize) await syncManagedConfiguration(worldId);
  const { world, command, args, env } = await prepareWorldStart(worldId, async (world) => {
    const prepared = commandFor(world);
    if (world.platform === "windows" && !(await inspectInstallation(world.installDir, world.platform)).executable) throw new Error("Windows server files are missing or incomplete; repair the installation before starting.");
    if (!executableAvailable(prepared.command, prepared.env)) throw new Error(`Server executable is not available: ${prepared.command}`);
    const prerequisite = await inspectPrerequisites(world);
    if (prerequisite.state === "missing") throw new Error(prerequisite.detail);
    await applyUe4ssLaunch(world, prepared.env);
    return { world, ...prepared };
  });
  const before = await processSnapshot();
  // A server already running from this installation is adopted rather than duplicated; only a
  // server a live manager of another profile owns blocks the start.
  const orphan = runningServerTree(world.installDir, before);
  if (orphan.length) { await adoptRunningServer(world, orphan, before); return; }
  await claimInstallation(world, before);
  await setRuntimeState(worldId, "starting", null);
  const launchedAt = Date.now();
  let exitCode: number | null = null;
  const logPath = path.join(/* turbopackIgnore: true */ paths.worldLogs(worldId), `server-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
  try {
    const stream = createWriteStream(logPath, { flags: "a" });
    stream.on("error", (error) => console.error(`Server log ${logPath} is not writable: ${error.message}`));
    try { await prepareWinePrefix({ ...world, winePrefix: env.WINEPREFIX ?? world.winePrefix }, env, (line) => stream.write(`${line}\n`)); }
    finally { await new Promise<void>((resolve) => stream.end(resolve)); }
    await resetBroadcastQueue(world).catch(() => undefined);
    // File descriptors, rather than manager-owned pipes, let the real server survive manager exit.
    const output = openSync(logPath, "a", 0o600);
    let child: ChildProcess;
    try { child = spawn(command, args, { cwd: world.installDir, env, detached: true, stdio: ["ignore", output, output], windowsHide: true }); }
    finally { closeSync(output); }
    let launchError: Error | undefined;
    child.once("error", (error) => { launchError = error; });
    await new Promise<void>((resolve) => { child.once("spawn", resolve); child.once("error", () => resolve()); });
    if (launchError) throw launchError;
    child.unref(); children().set(worldId, child);
    child.once("exit", (code, signal) => { exitCode = code; children().delete(worldId); void appendFile(logPath, `\n[manager] launcher exited code=${code} signal=${signal}\n`).catch(() => undefined); });
    let tracked: ProcessIdentity[] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      const snapshot = await processSnapshot();
      const root = snapshot.find((entry) => entry.pid === child.pid);
      tracked = ownedTree([...tracked, ...(root ? [root] : [])], snapshot);
      // Some native launchers exit before the first host snapshot. Accept only new executables
      // inside the exclusively claimed installation, never another world's process.
      for (const entry of snapshot) if (belongsToInstall(entry, world) && !before.some((old) => sameProcess(old, entry)) && !tracked.some((old) => sameProcess(old, entry))) tracked.push(entry);
      await persistIdentity(world, tracked);
      if (attempt < 2) await delay(250);
    }
    if (!tracked.length) throw new Error("Server exited during startup; inspect its log and prerequisite diagnostics.");
    await database().update(worlds).set({ lastStartedAt: Date.now(), updatedAt: Date.now() }).where(eq(worlds.id, worldId));
    await setRuntimeState(worldId, "running", tracked[0]!.pid);
    startDeathCapture(world);
  } catch (error) {
    const tracked = await identities(worldId);
    // Retain ownership if inspection failed or the spawned server might still be alive.
    const live = await processSnapshot().then((snapshot) => ownedTree(tracked, snapshot)).catch(() => null);
    if (live && !live.length && !children().get(worldId)?.pid) { await releaseInstallation(world); await setRuntimeState(worldId, "crashed", null); await recordUnexpectedExit(worldId, { code: exitCode, uptimeMs: Date.now() - launchedAt }).catch(() => undefined); }
    else await setRuntimeState(worldId, "unknown", children().get(worldId)?.pid ?? live?.[0]?.pid ?? null);
    throw error;
  }
}
