import "server-only";
import { createWriteStream, existsSync } from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import killTree from "tree-kill";
import type { WorldView } from "@/contracts/world";
import { paths } from "@/server/paths";
import { eventBus } from "./events";
import { getWorld, listWorlds, setRuntimeState } from "./worlds";

declare global { var __psmChildren: Map<string, ChildProcess> | undefined; }
const children = () => (globalThis.__psmChildren ??= new Map<string, ChildProcess>());

export function processIsAlive(pid: number | null): boolean {
  if (!pid || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
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
    world.restApiEnabled ? `-RESTAPIPort=${world.restApiPort}` : "",
    world.rconEnabled ? `-RCONPort=${world.rconPort}` : "",
    ...(world.legacyPerfFlags ? ["-useperfthreads", "-NoAsyncLoadingThread", "-UseMultithreadForDS"] : []),
    ...parseArguments(world.extraArgs),
  ].filter(Boolean);
  const env: NodeJS.ProcessEnv = { ...process.env, ...world.env };
  if (world.platform === "windows" && process.platform !== "win32") {
    if (world.winePrefix) env.WINEPREFIX = world.winePrefix;
    return { command: world.wineBinary, args: [...parseArguments(world.wineLaunchFlags), path.join(world.installDir, "PalServer.exe"), ...serverArgs], env };
  }
  return { command: world.platform === "windows" ? path.join(world.installDir, "PalServer.exe") : path.join(world.installDir, "PalServer.sh"), args: serverArgs, env };
}

export async function startWorld(worldId: string): Promise<void> {
  const world = await getWorld(worldId);
  if (!world) throw new Error("World not found.");
  if (world.processId && processIsAlive(world.processId)) throw new Error("World is already running.");
  const { command, args, env } = commandFor(world);
  if (!existsSync(command) && !command.includes(path.sep)) throw new Error(`Executable is not available: ${command}`);
  if (!existsSync(command) && command.includes(path.sep)) throw new Error(`Server executable is missing: ${command}`);
  await setRuntimeState(worldId, "starting", null);
  const logPath = path.join(paths.worldLogs(worldId), `server-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
  const stream = createWriteStream(logPath, { flags: "a" });
  const child = spawn(command, args, { cwd: world.installDir, env, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  child.stdout?.pipe(stream); child.stderr?.pipe(stream);
  child.on("error", async (error) => { stream.write(`\n[manager] ${error.message}\n`); await setRuntimeState(worldId, "crashed", null); });
  child.on("exit", async (code, signal) => {
    children().delete(worldId); stream.end(`\n[manager] exited code=${code ?? "null"} signal=${signal ?? "none"}\n`);
    const latest = await getWorld(worldId); const expected = latest?.status === "stopping";
    await setRuntimeState(worldId, expected || code === 0 ? "stopped" : "crashed", null);
  });
  children().set(worldId, child);
  await setRuntimeState(worldId, "running", child.pid ?? null);
}

export async function stopWorld(worldId: string, force = false): Promise<void> {
  const world = await getWorld(worldId); if (!world) throw new Error("World not found.");
  if (!world.processId || !processIsAlive(world.processId)) { await setRuntimeState(worldId, "stopped", null); return; }
  await setRuntimeState(worldId, "stopping", world.processId);
  await new Promise<void>((resolve, reject) => killTree(world.processId!, force ? "SIGKILL" : "SIGTERM", (error) => error ? reject(error) : resolve()));
  const deadline = Date.now() + (force ? 3_000 : 20_000);
  while (processIsAlive(world.processId) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 250));
  if (processIsAlive(world.processId)) await new Promise<void>((resolve, reject) => killTree(world.processId!, "SIGKILL", (error) => error ? reject(error) : resolve()));
  await setRuntimeState(worldId, "stopped", null);
}

export async function restartWorld(worldId: string): Promise<void> { await stopWorld(worldId); await startWorld(worldId); }

export async function reconcileProcesses(): Promise<void> {
  for (const world of await listWorlds()) {
    const alive = processIsAlive(world.processId);
    if (alive && world.status !== "running") await setRuntimeState(world.id, "running", world.processId);
    if (!alive && (world.processId || world.status !== "stopped")) await setRuntimeState(world.id, world.status === "running" ? "crashed" : "stopped", null);
  }
  eventBus().publish({ type: "system", data: { action: "processes-reconciled" } });
}
