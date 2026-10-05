import { hostPlatform } from "@/server/host";
import "server-only";
import { assertSupportedTarget } from "@/server/host";
import { windowsArguments } from "@/lib/arguments";
import { createWriteStream, existsSync, openSync, closeSync, appendFileSync } from "node:fs";
import path from "node:path";
import { writeFile, readFile, rm } from "node:fs/promises";
import { processSnapshot, ownedTree, sameProcess, type ProcessIdentity } from "./process-inspection";
import { inspectPrerequisites } from "./prerequisites";
import { spawn, type ChildProcess } from "node:child_process";
import killTree from "tree-kill";
import type { WorldView } from "@/contracts/world";
import { paths } from "@/server/paths";
import { database } from "@/server/db";
import { events, worlds } from "@/server/db/schema";
import { eq, sql } from "drizzle-orm";
import { eventBus } from "./events";
import { getWorld, listWorlds, setRuntimeState } from "./worlds";
import { applyDesiredSettings, prepareWorldStart, syncManagedConfiguration } from "./configuration";
import { palworldRest } from "./rest";
import { effectiveWinePrefix, prepareWinePrefix, runsUnderWine, serverWineOverrides, stopWineServer } from "./wine";
import { applyUe4ssLaunch, recordHealthyExit, recordUnexpectedExit } from "@/server/mods/ue4ss-runtime";
import { resetBroadcastQueue, startDeathCapture, stopDeathCapture } from "@/server/mods/relays";

// A process snapshot must not overwrite a concurrent start/stop. Jobs have their own
// admission lock; this lock also covers background inspection and delayed recovery.
declare global { var __psmLifecycleLocks: Map<string, Promise<void>> | undefined; var __psmRecoveryTimers: Map<string, NodeJS.Timeout> | undefined; }
const lifecycleLocks = () => (globalThis.__psmLifecycleLocks ??= new Map<string, Promise<void>>());
const recoveryTimers = () => (globalThis.__psmRecoveryTimers ??= new Map<string, NodeJS.Timeout>());
function tryLifecycleLock(worldId: string): (() => void) | null {
  if (lifecycleLocks().has(worldId)) return null;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  lifecycleLocks().set(worldId, pending);
  return () => { lifecycleLocks().delete(worldId); release(); };
}
async function withLifecycleLock<T>(worldId: string, work: () => Promise<T>): Promise<T> {
  let release: (() => void) | null;
  while (!(release = tryLifecycleLock(worldId))) await lifecycleLocks().get(worldId);
  try { return await work(); } finally { release(); }
}
function cancelRecovery(worldId: string): void {
  clearTimeout(recoveryTimers().get(worldId)); recoveryTimers().delete(worldId);
}

declare global { var __psmChildren: Map<string, ChildProcess> | undefined; }
const children = () => (globalThis.__psmChildren ??= new Map<string, ChildProcess>());

function executableAvailable(command: string, env: NodeJS.ProcessEnv): boolean {
  if (command.includes(path.sep)) return existsSync(command);
  return (env.PATH ?? "").split(path.delimiter).some((directory) => existsSync(path.join(/* turbopackIgnore: true */ directory, command)));
}

export function parseArguments(value: string): string[] {
  const args: string[] = [];
  let token = ""; let quote: "'" | '"' | null = null; let escaped = false;
  for (const character of value.trim()) {
    if (escaped) { token += character; escaped = false; continue; }
    if (character === "\\" && quote !== "'") { escaped = true; continue; }
    if (quote) { if (character === quote) quote = null; else token += character; continue; }
    if (character === "'" || character === '"') { quote = character; continue; }
    if (/\s/.test(character)) { if (token) { args.push(token); token = ""; } continue; }
    token += character;
  }
  if (escaped || quote) throw new Error("Launch arguments contain an unfinished quote or escape.");
  if (token) args.push(token);
  return args;
}

export function commandFor(world: WorldView): { command: string; args: string[]; env: NodeJS.ProcessEnv } {
  assertSupportedTarget(world.platform);
  const serverArgs = [
    `-port=${world.gamePort}`, `-queryport=${world.queryPort}`,
    ...(world.communityServer ? ["-publiclobby"] : []),
    ...(world.restApiEnabled ? ["-RESTAPIEnabled=true", `-RESTAPIPort=${world.restApiPort}`] : []),
    ...(world.rconEnabled ? ["-RCONEnabled=true", `-RCONPort=${world.rconPort}`] : []),
    ...(world.legacyPerfFlags ? ["-useperfthreads", "-NoAsyncLoadingThread", "-UseMultithreadForDS"] : []),
    ...(world.argumentFormat === "windows" ? windowsArguments(world.extraArgs) : parseArguments(world.extraArgs)),
  ];
  const env: NodeJS.ProcessEnv = { ...process.env, ...world.env };
  if (runsUnderWine(world)) {
    // World environment values win so a prefix or debug channel can still be set deliberately.
    env.WINEPREFIX = world.env.WINEPREFIX ?? effectiveWinePrefix(world);
    env.WINEDEBUG = world.env.WINEDEBUG ?? "-all";
    env.WINEDLLOVERRIDES = serverWineOverrides(env.WINEDLLOVERRIDES);
    return { command: world.wineBinary, args: [...parseArguments(world.wineLaunchFlags), path.join(/* turbopackIgnore: true */ world.installDir, "PalServer.exe"), ...serverArgs], env };
  }
  if (hostPlatform() === "win32") {
    // PalServer.exe starts this console-subsystem binary with a fresh STARTUPINFO,
    // losing windowsHide and redirected output. Spawn the same game directly so
    // DETACHED_PROCESS and our file handles apply to the process that actually runs.
    return {
      command: path.join(/* turbopackIgnore: true */ world.installDir, "Pal", "Binaries", "Win64", "PalServer-Win64-Shipping-Cmd.exe"),
      args: ["Pal", ...serverArgs, "-NoConsole", "-stdout", "-FullStdOutLogOutput", "-FORCELOGFLUSH"], env,
    };
  }
  return { command: path.join(/* turbopackIgnore: true */ world.installDir, "PalServer.sh"), args: serverArgs, env };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const launchLease = (world: WorldView) => path.join(/* turbopackIgnore: true */ world.installDir, ".psm-runtime-owner.json");
type RuntimeLease = { profile: string; owner: ProcessIdentity; processes: ProcessIdentity[] };
async function identities(worldId: string): Promise<ProcessIdentity[]> {
  const [row] = await database().select({ identity: worlds.processIdentity }).from(worlds).where(eq(worlds.id, worldId)); return row?.identity ?? [];
}
async function persistIdentity(world: WorldView, processes: ProcessIdentity[]): Promise<void> {
  await database().update(worlds).set({ processIdentity: processes }).where(eq(worlds.id, world.id));
  const file = launchLease(world);
  const lease = JSON.parse(await readFile(file, "utf8")) as RuntimeLease;
  if (lease.profile !== paths.data()) throw new Error("This installation belongs to another manager profile.");
  const temporary = `${file}.tmp-${process.pid}`;
  await writeFile(temporary, JSON.stringify({ ...lease, processes }), { mode: 0o600 });
  await process.getBuiltinModule("node:fs/promises").rename(temporary, file);
}
async function claimInstallation(world: WorldView, snapshot: ProcessIdentity[]): Promise<void> {
  const file = launchLease(world);
  try {
    const lease = JSON.parse(await readFile(file, "utf8")) as RuntimeLease;
    if (snapshot.some((row) => sameProcess(lease.owner, row)) || ownedTree(lease.processes, snapshot).length) throw new Error("This installation is already owned by a running manager or game server.");
    await rm(file);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const owner = snapshot.find((row) => row.pid === process.pid);
  if (!owner?.executable) throw new Error("Cannot establish manager process identity.");
  await writeFile(file, JSON.stringify({ profile: paths.data(), owner, processes: [] } satisfies RuntimeLease), { flag: "wx", mode: 0o600 });
}
async function releaseInstallation(world: WorldView): Promise<void> {
  const file = launchLease(world);
  const lease = await readFile(file, "utf8").then((text) => JSON.parse(text) as RuntimeLease).catch(() => null);
  if (lease?.profile === paths.data()) await rm(file, { force: true });
}
function belongsToInstall(entry: ProcessIdentity, world: WorldView): boolean {
  const relative = path.relative(world.installDir, entry.executable);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}
export async function startWorld(worldId: string): Promise<void> {
  cancelRecovery(worldId);
  return withLifecycleLock(worldId, () => startWorldProcess(worldId));
}
async function startWorldProcess(worldId: string): Promise<void> {
  const candidate = await getWorld(worldId);
  if (candidate) { const { inspectInstallation } = await import("./installation"); if ((await inspectInstallation(candidate.installDir, candidate.platform)).canInitialize) await syncManagedConfiguration(worldId); }
  const { world, command, args, env } = await prepareWorldStart(worldId, async (world) => {
    const prepared = commandFor(world);
    if (world.platform === "windows") { const { inspectInstallation } = await import("./installation"); if (!(await inspectInstallation(world.installDir, world.platform)).executable) throw new Error("Windows server files are missing or incomplete; repair the installation before starting."); }
    if (!executableAvailable(prepared.command, prepared.env)) throw new Error(`Server executable is not available: ${prepared.command}`);
    const prerequisite = await inspectPrerequisites(world);
    if (prerequisite.state === "missing") throw new Error(prerequisite.detail);
    await applyUe4ssLaunch(world, prepared.env);
    return { world, ...prepared };
  });
  const before = await processSnapshot();
  // An untracked server in this installation must be resolved before launching a duplicate.
  if (before.some((entry) => belongsToInstall(entry, world))) throw new Error("A server process already uses this installation; its ownership must be resolved before starting.");
  await claimInstallation(world, before);
  await setRuntimeState(worldId, "starting", null);
  const launchedAt = Date.now();
  let exitCode: number | null = null;
  const logPath = path.join(/* turbopackIgnore: true */ paths.worldLogs(worldId), `server-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
  try {
    const stream = createWriteStream(logPath, { flags: "a" });
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
    child.once("exit", (code, signal) => { exitCode = code; children().delete(worldId); appendFileSync(logPath, `\n[manager] launcher exited code=${code} signal=${signal}\n`); });
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
    startProcessMonitor();
  } catch (error) {
    const tracked = await identities(worldId);
    // Retain ownership if inspection failed or the spawned server might still be alive.
    const live = await processSnapshot().then((snapshot) => ownedTree(tracked, snapshot)).catch(() => null);
    if (live && !live.length && !children().get(worldId)?.pid) { await releaseInstallation(world); await setRuntimeState(worldId, "crashed", null); await recordUnexpectedExit(worldId, { code: exitCode, uptimeMs: Date.now() - launchedAt }).catch(() => undefined); }
    else await setRuntimeState(worldId, "unknown", children().get(worldId)?.pid ?? live?.[0]?.pid ?? null);
    throw error;
  }
}
async function verifiedProcesses(world: WorldView): Promise<ProcessIdentity[]> {
  const roots = await identities(world.id);
  if (!roots.length && (world.processId || world.status === "unknown")) throw new Error("Cannot verify ownership of this saved PID. Inspect the server process before changing it.");
  const snapshot = await processSnapshot();
  if (roots.some((root) => snapshot.some((row) => row.pid === root.pid && !sameProcess(root, row)))) throw new Error("Saved process identity no longer matches. Refusing to target a reused PID.");
  const live = ownedTree(roots, snapshot);
  if (live.length) await persistIdentity(world, live);
  return live;
}
export async function stopWorld(worldId: string, force = false, options: { waitSeconds?: number; message?: string } = {}): Promise<void> {
  cancelRecovery(worldId);
  return withLifecycleLock(worldId, async () => {
    // Inspection may have scheduled recovery while Stop waited for its snapshot.
    cancelRecovery(worldId);
    await stopWorldProcess(worldId, force, options);
  });
}
async function stopWorldProcess(worldId: string, force: boolean, options: { waitSeconds?: number; message?: string }): Promise<void> {
  const world = await getWorld(worldId); if (!world) throw new Error("World not found.");
  let live = await verifiedProcesses(world);
  await setRuntimeState(worldId, "stopping", live[0]?.pid ?? null);
  let graceful = false;
  if (live.length && !force && world.restApiEnabled) {
    try { await palworldRest.save(world); await palworldRest.shutdown(world, options.waitSeconds ?? 15, options.message ?? "Server shutting down."); graceful = true; } catch { /* Report forced fallback through the operation log/state. */ }
  }
  const deadline = Date.now() + (graceful ? ((options.waitSeconds ?? 15) + 10) * 1000 : 0);
  while (live.length && Date.now() < deadline) { await delay(500); live = await verifiedProcesses(world); }
  if (live.length) {
    await database().insert(events).values({ worldId, kind: "lifecycle", message: force ? "Forced termination requested; verifying the owned server process tree has exited." : "Graceful shutdown did not complete; terminating the owned server process tree.", createdAt: Date.now() });
    for (const identity of live.reverse()) {
      const current = (await processSnapshot()).find((row) => sameProcess(identity, row));
      if (!current) continue;
      await new Promise<void>((resolve, reject) => killTree(current.pid, hostPlatform() === "win32" || force ? "SIGKILL" : "SIGTERM", (error) => error && !/no such process/i.test(error.message) ? reject(error) : resolve()));
    }
    const forceAt = Date.now() + 3_000;
    while ((live = await verifiedProcesses(world)).length && Date.now() < forceAt) await delay(250);
    for (const identity of live) {
      if (!(await processSnapshot()).some((row) => sameProcess(identity, row))) continue;
      await new Promise<void>((resolve, reject) => killTree(identity.pid, "SIGKILL", (error) => error ? reject(error) : resolve()));
    }
  }
  await stopWineServer(world, force);
  for (let attempt = 0; attempt < 20 && (await verifiedProcesses(world)).length; attempt++) await delay(250);
  if ((await verifiedProcesses(world)).length) { await setRuntimeState(worldId, "unknown", world.processId); throw new Error("Server processes are still alive; conflicting actions remain blocked."); }
  await stopDeathCapture(world).catch(() => undefined);
  await database().update(worlds).set({ processIdentity: null }).where(eq(worlds.id, worldId));
  await releaseInstallation(world);
  await setRuntimeState(worldId, "stopped", null);
  await recordHealthyExit(worldId).catch(() => undefined);
  const application = await applyDesiredSettings(worldId);
  if (application.pendingApply) throw new Error(`Server stopped; settings remain pending${application.applyError ? `: ${application.applyError}` : "."}`);
}
export async function restartWorld(worldId: string, options: { waitSeconds?: number; message?: string } = {}): Promise<void> { await stopWorld(worldId, false, options); await startWorld(worldId); }

declare global { var __psmProcessTimer: NodeJS.Timeout | undefined; var __psmReconciling: boolean | undefined; var __psmInspectionError: string | undefined; }
function startProcessMonitor() {
  if (globalThis.__psmProcessTimer) return;
  globalThis.__psmProcessTimer = setInterval(() => { if (!globalThis.__psmDraining) void reconcileProcesses().catch(() => undefined); }, 2_000);
  globalThis.__psmProcessTimer.unref();
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
    if (!registered.some((world) => world.processId || ["running", "starting", "stopping"].includes(world.status))) return;
    let snapshot: ProcessIdentity[];
    try { snapshot = await processSnapshot(); globalThis.__psmInspectionError = undefined; }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const world of registered) if (world.processId || world.status === "running") await setRuntimeState(world.id, "unknown", world.processId);
      if (globalThis.__psmInspectionError !== message) { globalThis.__psmInspectionError = message; console.error(`Process inspection failed; ownership remains unverified: ${message}`); }
      startProcessMonitor(); return;
    }
    for (const world of registered) {
      if (world.status === "starting" && !world.processId && children().has(world.id)) continue;
      const roots = await identities(world.id);
      if (!roots.length && world.processId) { await setRuntimeState(world.id, "unknown", world.processId); continue; }
      const live = ownedTree(roots, snapshot);
      if (live.length) {
        try { await persistIdentity(world, live); } catch { await setRuntimeState(world.id, "unknown", world.processId); continue; }
        if (world.status !== "stopping") await setRuntimeState(world.id, "running", live[0]!.pid);
        startDeathCapture(world); continue;
      }
      if (world.status === "stopping") continue;
      if (world.processId || world.status === "running") {
        const reused = roots.some((root) => snapshot.some((entry) => entry.pid === root.pid && !sameProcess(root, entry)));
        if (reused) { await setRuntimeState(world.id, "unknown", world.processId); continue; }
        await stopDeathCapture(world).catch(() => undefined); await releaseInstallation(world);
        await database().update(worlds).set({ processIdentity: null }).where(eq(worlds.id, world.id));
        await setRuntimeState(world.id, "crashed", null);
        const pause = await recordUnexpectedExit(world.id, { code: null, uptimeMs: world.lastStartedAt ? Date.now() - world.lastStartedAt : 0 }).catch(() => true);
        if (world.crashGuard && !pause && !globalThis.__psmDraining) {
          await database().update(worlds).set({ crashCount: sql`${worlds.crashCount} + 1` }).where(eq(worlds.id, world.id));
          cancelRecovery(world.id);
          const timer = setTimeout(() => {
            recoveryTimers().delete(world.id);
            if (globalThis.__psmDraining) return;
            void import("./jobs").then(({ startJob }) => startJob(world.id, "crash-recovery", () => withLifecycleLock(world.id, async () => {
              const current = await getWorld(world.id);
              if (!current || current.status !== "crashed" || !current.crashGuard || current.lastStartedAt !== world.lastStartedAt || globalThis.__psmDraining) return;
              await startWorldProcess(world.id);
            }))).catch(() => undefined);
          }, 5_000);
          recoveryTimers().set(world.id, timer); timer.unref();
        }
      }
    }
    startProcessMonitor();
  } finally { for (const release of releases) release(); globalThis.__psmReconciling = false; }
  eventBus().publish({ type: "system", data: { action: "processes-reconciled" } });
}
