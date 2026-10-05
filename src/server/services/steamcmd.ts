import { hostPlatform } from "@/server/host";
import "server-only";
import { checkManagedMods, describeIntegrity } from "@/server/mods/integrity";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { mkdir, writeFile, readFile, rm, rename, stat, open } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import killTree from "tree-kill";
import AdmZip from "adm-zip";
import { randomUUID } from "node:crypto";
import { safeEntries } from "./archive";
import { assertSupportedTarget } from "@/server/host";
import { processSnapshot, sameProcess, type ProcessIdentity } from "./process-inspection";
import type { WorldView } from "@/contracts/world";
import type { JobContext } from "./jobs";
import { paths } from "@/server/paths";
import { database } from "@/server/db";
import { worlds } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { syncManagedConfiguration } from "./configuration";

const APP_ID = "2394010";
export function steamCmdHost() {
  const windows = hostPlatform() === "win32";
  return { url: `https://steamcdn-a.akamaihd.net/client/installer/${windows ? "steamcmd.zip" : "steamcmd_linux.tar.gz"}`, executable: windows ? "steamcmd.exe" : "steamcmd.sh", archive: windows ? "steamcmd.zip" : "steamcmd.tar.gz" };
}
function binary(): string { return path.join(/* turbopackIgnore: true */ paths.steamCmd(), steamCmdHost().executable); }

// This file survives manager death, including the interval between spawn and identity recording.
// A stale lease is reclaimed only after a host snapshot proves no SteamCMD worker remains.
type Lease = { id: string; owner: ProcessIdentity; worker?: ProcessIdentity };
let queue: Promise<void> = Promise.resolve();
async function exclusive<T>(context: JobContext, task: () => Promise<T>): Promise<T> {
  let release!: () => void; const previous = queue;
  const slot = new Promise<void>((resolve) => { release = resolve; });
  queue = previous.then(() => slot);
  try {
    await context.update(0, "Waiting for shared SteamCMD client");
    await new Promise<void>((resolve, reject) => { const abort = () => reject(context.signal.reason); context.signal.addEventListener("abort", abort, { once: true }); previous.then(() => { context.signal.removeEventListener("abort", abort); resolve(); }); if (context.signal.aborted) abort(); }); context.signal.throwIfAborted();
    const leasePath = path.join(/* turbopackIgnore: true */ paths.steamCmd(), ".psm-owner.json");
    const snapshot = await processSnapshot();
    const owner = snapshot.find((entry) => entry.pid === process.pid);
    if (!owner?.executable) throw new Error("Cannot verify SteamCMD operation ownership.");
    try {
      const lease = JSON.parse(await readFile(leasePath, "utf8")) as Lease;
      const live = snapshot.some((entry) => sameProcess(lease.owner, entry) || (lease.worker && sameProcess(lease.worker, entry)) || /steamcmd(?:\.exe|\.sh)?/i.test(entry.executable));
      if (live) throw new Error("SteamCMD is still owned by an existing operation. Wait for it to finish before retrying.");
      await rm(leasePath);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await writeFile(leasePath, JSON.stringify({ id: randomUUID(), owner }), { flag: "wx", mode: 0o600 });
    try { return await task(); } finally { await rm(leasePath, { force: true }); }
  } finally { release(); }
}

function redact(text: string): string {
  const secrets = [process.env.PSM_STEAM_PASSWORD, process.env.PSM_STEAM_USERNAME].filter(Boolean) as string[];
  return secrets.reduce((value, secret) => value.replaceAll(secret, "[redacted]"), text);
}

async function run(command: string, args: string[], cwd: string, context: JobContext): Promise<{ code: number; output: string }> {
  return await new Promise((resolve, reject) => {
    context.signal.throwIfAborted();
    const child = spawn(command, args, { cwd, windowsHide: true, env: process.env });
    const leasePath = path.join(/* turbopackIgnore: true */ paths.steamCmd(), ".psm-owner.json");
    const lease = existsSync(leasePath) ? JSON.parse(readFileSync(leasePath, "utf8")) as Lease : null;
    child.once("spawn", () => { void processSnapshot().then((snapshot) => {
      const worker = snapshot.find((entry) => entry.pid === child.pid);
      if (!worker || !lease || !existsSync(leasePath)) return;
      const current = JSON.parse(readFileSync(leasePath, "utf8")) as Lease;
      if (current.id !== lease.id) return;
      const temporary = `${leasePath}.tmp-${process.pid}`;
      writeFileSync(temporary, JSON.stringify({ ...current, worker }), { mode: 0o600 }); renameSync(temporary, leasePath);
    }).catch((error) => context.log(`Could not record worker identity: ${error instanceof Error ? error.message : String(error)}`)); });
    let output = "";
    let forceTimer: NodeJS.Timeout | undefined;
    const abort = () => {
      if (!child.pid) return;
      context.log("Cancellation requested; stopping SteamCMD.");
      killTree(child.pid, "SIGTERM", (error) => { if (error && !/no such process/i.test(error.message)) context.log(`SteamCMD termination warning: ${error.message}`); });
      forceTimer = setTimeout(() => { if (child.exitCode == null && child.pid) killTree(child.pid, "SIGKILL", () => undefined); }, 5_000);
      forceTimer.unref();
    };
    context.signal.addEventListener("abort", abort, { once: true });
    const emit = (line: string) => {
      const text = redact(line); output = (output + text + "\n").slice(-512_000); if (text) context.log(text);
      if (args.includes("+app_update")) {
        const progress = text.match(/Update state.*progress:\s*([\d.]+)/i);
        if (progress) void context.update(15 + Math.min(100, Number(progress[1])) * 0.75, "Installing and validating game files").catch(() => undefined);
        else if (/Logging in|Connecting anonymously|Waiting for user info/i.test(text)) void context.update(10, "Logging in to Steam").catch(() => undefined);
      }
    };
    const consumers = [child.stdout, child.stderr].map((stream) => {
      let pending = ""; stream?.setEncoding("utf8");
      stream?.on("data", (chunk: string) => { pending += chunk; const lines = pending.split(/[\r\n]/); pending = lines.pop() ?? ""; for (const line of lines) emit(line); if (pending.length > 512_000) { pending = ""; emit("[Oversized output line omitted]"); } });
      return () => emit(pending);
    });
    const timeout = setTimeout(() => { context.log("SteamCMD exceeded the two-hour operation limit."); abort(); }, 2 * 60 * 60 * 1000); timeout.unref();
    child.on("error", (error) => { clearTimeout(timeout); reject(new Error(`${command}: ${error.message}. Check the host client dependencies and retry.`)); }); child.on("close", (code) => { clearTimeout(timeout); consumers.forEach((flush) => flush()); if (forceTimer) clearTimeout(forceTimer); context.signal.removeEventListener("abort", abort); if (context.signal.aborted) reject(context.signal.reason); else resolve({ code: code ?? -1, output }); });
  });
}

async function bootstrap(context: JobContext): Promise<void> {
  const root = paths.steamCmd(); const spec = steamCmdHost();
  const marker = path.join(/* turbopackIgnore: true */ root, ".psm-ready.json");
  if (existsSync(binary()) && existsSync(marker)) { try { const ready = JSON.parse(await readFile(marker, "utf8")); if (ready.platform === hostPlatform() && (await stat(binary())).size > 0) return; } catch { /* An interrupted or old bootstrap must be repaired. */ } }
  const staging = path.join(/* turbopackIgnore: true */ root, `.bootstrap-${randomUUID()}`);
  await mkdir(staging, { recursive: true });
  try {
    await context.update(2, "Downloading SteamCMD");
    const response = await fetch(spec.url, { signal: AbortSignal.any([context.signal, AbortSignal.timeout(120_000)]) });
    if (!response.ok || !response.body) throw new Error(`SteamCMD download failed: HTTP ${response.status}`);
    const archive = path.join(/* turbopackIgnore: true */ staging, spec.archive); const file = await open(archive, "wx"); let bytes = 0; let reportedAt = 0;
    try { for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      context.signal.throwIfAborted(); bytes += chunk.byteLength;
      if (bytes > 64 * 1024 * 1024) throw new Error("SteamCMD bootstrap exceeds the 64 MiB limit.");
      await file.write(chunk);
      if (Date.now() - reportedAt >= 500) { await context.update(2, `Downloading SteamCMD: ${(bytes / 1024 / 1024).toFixed(1)} MiB`); reportedAt = Date.now(); }
    } } finally { await file.close(); }
    context.log(`Downloaded ${bytes} bytes from ${spec.url}`);
    await context.update(5, "Extracting SteamCMD");
    if (hostPlatform() === "win32") {
      const zip = new AdmZip(archive);
      if (!safeEntries(zip) || zip.getEntries().reduce((sum, entry) => sum + entry.header.size, 0) > 256 * 1024 * 1024) throw new Error("SteamCMD archive contains unsafe paths or exceeds the extraction limit.");
      zip.extractAllTo(staging, true);
    } else {
      const result = await run("tar", ["-xzf", archive, "-C", staging], staging, context);
      if (result.code !== 0) throw new Error("SteamCMD extraction failed. Install tar and the SteamCMD 32-bit runtime dependencies, then retry.");
    }
    const client = path.join(/* turbopackIgnore: true */ staging, spec.executable);
    if (!(await stat(client)).isFile() || (await stat(client)).size === 0) throw new Error("SteamCMD archive is missing a usable client.");
    await context.update(7, "Initializing SteamCMD client");
    const initialized = await run(client, ["+quit"], staging, context);
    if (initialized.code !== 0) throw new Error(`SteamCMD initialization failed (${initialized.code}). Inspect operation output and host runtime dependencies.`);
    context.signal.throwIfAborted();
    await rm(archive, { force: true });
    // Promote only a client which completed its own initialization. Keep the lease in root.
    const { readdir } = await import("node:fs/promises");
    for (const name of await readdir(staging)) { const target = path.join(/* turbopackIgnore: true */ root, name); await rm(target, { recursive: true, force: true }); await rename(path.join(/* turbopackIgnore: true */ staging, name), target); }
    await writeFile(marker, JSON.stringify({ platform: hostPlatform(), initializedAt: Date.now() }));
  } finally { await rm(staging, { recursive: true, force: true }); }
}
export async function ensureSteamCmd(context: JobContext): Promise<void> { return exclusive(context, () => bootstrap(context)); }

function manifestPath(world: WorldView): string { return path.join(/* turbopackIgnore: true */ world.installDir, "steamapps", `appmanifest_${APP_ID}.acf`); }
export function readBuildId(world: WorldView): string | null { return readInstalledBuild(world)?.buildId ?? null; }
export function readInstalledBuild(world: WorldView): { buildId: string; manifestPath: string } | null {
  for (const candidate of [manifestPath(world), path.join(/* turbopackIgnore: true */ world.installDir, "..", "..", `appmanifest_${APP_ID}.acf`)]) {
    try { const content = readFileSync(candidate, "utf8"); if (!new RegExp(`"appid"\\s+"${APP_ID}"`).test(content)) continue; const id = content.match(/"buildid"\s+"([^"\r\n]+)"/i)?.[1]; if (id) return { buildId: id, manifestPath: candidate }; } catch { /* Manual copies need not have a manifest. */ }
  }
  return null;
}

export async function detectLatestBuild(worldId: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(`https://api.steamcmd.net/v1/info/${APP_ID}`, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Steam build lookup failed: HTTP ${response.status}`);
  const payload = await response.json() as { data?: Record<string, { depots?: { branches?: { public?: { buildid?: string | number } } } }> };
  const buildId = payload.data?.[APP_ID]?.depots?.branches?.public?.buildid;
  if (!buildId) throw new Error("Steam did not report a public Palworld build.");
  const latestBuildId = String(buildId);
  await database().update(worlds).set({ latestBuildId, updatedAt: Date.now() }).where(eq(worlds.id, worldId));
  return latestBuildId;
}

async function invoke(world: WorldView, context: JobContext): Promise<{ code: number; output: string }> {
  const username = process.env.PSM_STEAM_USERNAME || "anonymous";
  const password = process.env.PSM_STEAM_PASSWORD;
  const args = [
    "+force_install_dir", world.installDir,
    "+@sSteamCmdForcePlatformType", world.platform, "+@sSteamCmdForcePlatformBitness", "64",
    "+login", username, ...(password ? [password] : []),
    "+app_update", APP_ID, "validate", "+quit",
  ];
  return run(binary(), args, paths.steamCmd(), context);
}

export async function installOrUpdate(world: WorldView, context: JobContext): Promise<void> {
  assertSupportedTarget(world.platform);
  if (world.processId || ["running", "starting", "stopping", "unknown"].includes(world.status)) throw new Error("Stop the world before installing or updating server files.");
  return exclusive(context, async () => {
  const latestBuildId = await detectLatestBuild(world.id, context.signal).catch(async (error) => { context.signal.throwIfAborted(); context.log(`Build discovery unavailable; continuing with Valve: ${error.message}`); await database().update(worlds).set({ latestBuildId: null }).where(eq(worlds.id, world.id)); return null; });
  context.log(`Latest public build: ${latestBuildId}; installed build: ${readBuildId(world) ?? "unknown"}.`);
  await bootstrap(context);
  await mkdir(world.installDir, { recursive: true });
  const before = readBuildId(world);
  await context.update(10, "Logging in to Steam");
  let result = await invoke(world, context);
  const denied = /Failed to get manifest request code.*Access Denied/i.test(result.output);
  if (result.code !== 0 && denied && existsSync(manifestPath(world))) {
    const preserved = `${manifestPath(world)}.failed-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    renameSync(manifestPath(world), preserved);
    context.log(`Preserved denied manifest as ${path.basename(preserved)}; retrying with fresh metadata.`);
    result = await invoke(world, context);
  }
  const buildId = readBuildId(world);
  const executable = path.join(/* turbopackIgnore: true */ world.installDir, world.platform === "windows" ? "PalServer.exe" : "PalServer.sh");
  if (!existsSync(executable) || !buildId || result.code !== 0) {
    const reason = result.output.match(/Error![^\r\n]*/i)?.[0] ?? `SteamCMD exited with code ${result.code}`;
    throw new Error(redact(reason));
  }
  if (world.platform === "windows") {
    const { inspectInstallation } = await import("./installation");
    if (!(await inspectInstallation(world.installDir, world.platform)).executable) throw new Error("SteamCMD completed, but the Windows launcher or shipping server is missing or invalid. Inspect operation output and retry installation.");
  }
  await database().update(worlds).set({ buildId, updatedAt: Date.now() }).where(eq(worlds.id, world.id));
  const configuration = await syncManagedConfiguration(world.id, { syncPublicPort: before == null });
  if (!configuration.synchronized) throw new Error(configuration.reason ?? "PalWorldSettings.ini could not be initialized.");
  context.log(configuration.initialized ? "Initialized PalWorldSettings.ini from the shipped defaults." : "Preserved and synchronized the existing PalWorldSettings.ini.");
  // SteamCMD only repairs files in the game's depot, but a game update can still replace files
  // around PSM's mods. Report it here; repairing is a separate, user-started operation.
  const mods = await checkManagedMods(world).catch(() => null);
  if (mods?.checked) context.log(`Mods: ${describeIntegrity(mods)}`);
  await context.update(100, `Installed build ${buildId}`);
  });
}
