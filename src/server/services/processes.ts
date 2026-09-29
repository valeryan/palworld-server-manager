import "server-only";
import { createWriteStream, existsSync } from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import killTree from "tree-kill";
import type { WorldView } from "@/contracts/world";
import { paths } from "@/server/paths";
import { database } from "@/server/db";
import { worlds } from "@/server/db/schema";
import { eq, sql } from "drizzle-orm";
import { eventBus } from "./events";
import { getWorld, listWorlds, setRuntimeState } from "./worlds";
import { applyDesiredSettings, prepareWorldStart } from "./configuration";
import { palworldRest } from "./rest";
import { effectiveWinePrefix, prepareWinePrefix, runsUnderWine, serverWineOverrides } from "./wine";

declare global { var __psmChildren: Map<string, ChildProcess> | undefined; }
const children = () => (globalThis.__psmChildren ??= new Map<string, ChildProcess>());

export function processIsAlive(pid: number | null): boolean {
  if (!pid || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function executableAvailable(command: string, env: NodeJS.ProcessEnv): boolean {
  if (command.includes(path.sep)) return existsSync(command);
  return (env.PATH ?? "").split(path.delimiter).some((directory) => existsSync(path.join(directory, command)));
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
  const serverArgs = [
    `-port=${world.gamePort}`, `-queryport=${world.queryPort}`,
    world.communityServer ? "-publiclobby" : "",
    ...(world.restApiEnabled ? ["-RESTAPIEnabled=true", `-RESTAPIPort=${world.restApiPort}`] : []),
    ...(world.rconEnabled ? ["-RCONEnabled=true", `-RCONPort=${world.rconPort}`] : []),
    ...(world.legacyPerfFlags ? ["-useperfthreads", "-NoAsyncLoadingThread", "-UseMultithreadForDS"] : []),
    ...parseArguments(world.extraArgs),
  ].filter(Boolean);
  const env: NodeJS.ProcessEnv = { ...process.env, ...world.env };
  if (runsUnderWine(world)) {
    // World environment values win so a prefix or debug channel can still be set deliberately.
    env.WINEPREFIX = world.env.WINEPREFIX ?? effectiveWinePrefix(world);
    env.WINEDEBUG = world.env.WINEDEBUG ?? "-all";
    env.WINEDLLOVERRIDES = serverWineOverrides(env.WINEDLLOVERRIDES);
    return { command: world.wineBinary, args: [...parseArguments(world.wineLaunchFlags), path.join(world.installDir, "PalServer.exe"), ...serverArgs], env };
  }
  return { command: world.platform === "windows" ? path.join(world.installDir, "PalServer.exe") : path.join(world.installDir, "PalServer.sh"), args: serverArgs, env };
}

export async function startWorld(worldId: string): Promise<void> {
  const { world, command, args, env } = await prepareWorldStart(worldId, async (world) => {
    const prepared = commandFor(world);
    if (!executableAvailable(prepared.command, prepared.env)) throw new Error(`Server executable is not available: ${prepared.command}`);
    await setRuntimeState(worldId, "starting", null);
    return { world, ...prepared };
  });
  const logPath = path.join(paths.worldLogs(worldId), `server-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
  const stream = createWriteStream(logPath, { flags: "a" });
  try { await prepareWinePrefix({ ...world, winePrefix: env.WINEPREFIX ?? world.winePrefix }, env, (line) => stream.write(`${line}\n`)); }
  catch (error) {
    stream.end(`[manager] Wine prefix preparation failed: ${error instanceof Error ? error.message : String(error)}\n`);
    await setRuntimeState(worldId, "stopped", null);
    throw new Error(`Wine prefix preparation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const child = spawn(command, args, { cwd: world.installDir, env, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  child.stdout?.pipe(stream); child.stderr?.pipe(stream);
  child.on("error", async (error) => { stream.write(`\n[manager] ${error.message}\n`); await setRuntimeState(worldId, "crashed", null); });
  child.on("exit", async (code, signal) => {
    children().delete(worldId); stream.end(`\n[manager] exited code=${code ?? "null"} signal=${signal ?? "none"}\n`);
    const latest = await getWorld(worldId); const expected = latest?.status === "stopping";
    // A controlled stop remains transitional until stopWorld has projected the
    // latest desired revision after the process is confirmed gone.
    if (!expected) {
      await setRuntimeState(worldId, code === 0 ? "stopped" : "crashed", null);
      await applyDesiredSettings(worldId).catch(() => undefined);
    }
    if (!expected && code !== 0 && latest?.crashGuard) {
      await database().update(worlds).set({ crashCount: sql`${worlds.crashCount} + 1` }).where(eq(worlds.id, worldId));
      setTimeout(() => void import("./jobs").then(({ startJob }) => startJob(worldId, "crash-recovery", async () => startWorld(worldId))).catch(() => undefined), 5_000);
    }
  });
  children().set(worldId, child);
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (!processIsAlive(child.pid ?? null)) throw new Error("Server process exited during startup; inspect the world log for details.");
  await database().update(worlds).set({ lastStartedAt: Date.now(), updatedAt: Date.now() }).where(eq(worlds.id, worldId));
  await setRuntimeState(worldId, "running", child.pid ?? null);
}

export async function stopWorld(worldId: string, force = false, options: { waitSeconds?: number; message?: string } = {}): Promise<void> {
  const world = await getWorld(worldId); if (!world) throw new Error("World not found.");
  if (!world.processId || !processIsAlive(world.processId)) {
    await setRuntimeState(worldId, "stopped", null);
    const application = await applyDesiredSettings(worldId);
    if (application.pendingApply) throw new Error(`Server stopped; settings remain pending${application.applyError ? `: ${application.applyError}` : "."}`);
    return;
  }
  await setRuntimeState(worldId, "stopping", world.processId);
  let gracefulShutdownRequested = false;
  if (!force && world.restApiEnabled) {
    try {
      await palworldRest.save(world).catch(() => undefined);
      await palworldRest.shutdown(world, options.waitSeconds ?? 15, options.message ?? "Server shutting down.");
      gracefulShutdownRequested = true;
    } catch { /* REST may not be ready; signal fallback below remains safe. */ }
  }
  const gracefulDeadline = Date.now() + (force || !gracefulShutdownRequested ? 0 : ((options.waitSeconds ?? 15) + 10) * 1_000);
  while (processIsAlive(world.processId) && Date.now() < gracefulDeadline) await new Promise((resolve) => setTimeout(resolve, 250));
  if (processIsAlive(world.processId)) await new Promise<void>((resolve, reject) => killTree(world.processId!, force ? "SIGKILL" : "SIGTERM", (error) => error ? reject(error) : resolve()));
  const deadline = Date.now() + (force ? 3_000 : 10_000);
  while (processIsAlive(world.processId) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 250));
  if (processIsAlive(world.processId)) await new Promise<void>((resolve, reject) => killTree(world.processId!, "SIGKILL", (error) => error ? reject(error) : resolve()));
  await setRuntimeState(worldId, "stopped", null);
  const application = await applyDesiredSettings(worldId);
  if (application.pendingApply) throw new Error(`Server stopped; settings remain pending${application.applyError ? `: ${application.applyError}` : "."}`);
}

export async function restartWorld(worldId: string, options: { waitSeconds?: number; message?: string } = {}): Promise<void> { await stopWorld(worldId, false, options); await startWorld(worldId); }

export async function reconcileProcesses(): Promise<void> {
  for (const world of await listWorlds()) {
    const alive = processIsAlive(world.processId);
    if (alive && world.status !== "running") await setRuntimeState(world.id, "running", world.processId);
    if (!alive && (world.processId || world.status !== "stopped")) await setRuntimeState(world.id, world.status === "running" ? "crashed" : "stopped", null);
  }
  eventBus().publish({ type: "system", data: { action: "processes-reconciled" } });
}
