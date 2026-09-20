import "server-only";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import type { WorldView } from "@/contracts/world";
import type { JobContext } from "./jobs";
import { paths } from "@/server/paths";
import { database } from "@/server/db";
import { worlds } from "@/server/db/schema";
import { eq } from "drizzle-orm";

const APP_ID = "2394010";
const DOWNLOAD_URL = process.platform === "win32"
  ? "https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip"
  : "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz";

function binary(): string {
  return path.join(paths.steamCmd(), process.platform === "win32" ? "steamcmd.exe" : "steamcmd.sh");
}

function redact(text: string): string {
  const secrets = [process.env.PSM_STEAM_PASSWORD, process.env.PSM_STEAM_USERNAME].filter(Boolean) as string[];
  return secrets.reduce((value, secret) => value.replaceAll(secret, "[redacted]"), text);
}

async function run(command: string, args: string[], cwd: string, context: JobContext): Promise<{ code: number; output: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, env: process.env });
    let output = "";
    const consume = (chunk: Buffer) => {
      const text = redact(chunk.toString()); output = (output + text).slice(-512_000);
      for (const line of text.split(/\r?\n/).filter(Boolean)) context.log(line);
    };
    child.stdout?.on("data", consume); child.stderr?.on("data", consume);
    child.on("error", reject); child.on("close", (code) => resolve({ code: code ?? -1, output }));
  });
}

export async function ensureSteamCmd(context: JobContext): Promise<void> {
  if (existsSync(binary())) return;
  await context.update(5, "Downloading SteamCMD");
  await mkdir(paths.steamCmd(), { recursive: true });
  const response = await fetch(DOWNLOAD_URL);
  if (!response.ok) throw new Error(`SteamCMD download failed: HTTP ${response.status}`);
  const archive = path.join(paths.steamCmd(), process.platform === "win32" ? "steamcmd.zip" : "steamcmd.tar.gz");
  await writeFile(archive, Buffer.from(await response.arrayBuffer()));
  if (process.platform === "win32") throw new Error("Windows SteamCMD extraction will be enabled with the Windows packaging milestone.");
  const result = await run("tar", ["-xzf", archive, "-C", paths.steamCmd()], paths.steamCmd(), context);
  if (result.code !== 0 || !existsSync(binary())) throw new Error("SteamCMD archive could not be extracted.");
}

function manifestPath(world: WorldView): string { return path.join(world.installDir, "steamapps", `appmanifest_${APP_ID}.acf`); }
export function readBuildId(world: WorldView): string | null {
  try { return readFileSync(manifestPath(world), "utf8").match(/"buildid"\s+"([^"\r\n]+)"/i)?.[1] ?? null; }
  catch { return null; }
}

async function invoke(world: WorldView, context: JobContext): Promise<{ code: number; output: string }> {
  const username = process.env.PSM_STEAM_USERNAME || "anonymous";
  const password = process.env.PSM_STEAM_PASSWORD;
  const args = [
    "+force_install_dir", world.installDir,
    ...(world.platform === "windows" ? ["+@sSteamCmdForcePlatformType", "windows"] : []),
    "+login", username, ...(password ? [password] : []),
    "+app_update", APP_ID, "validate", "+quit",
  ];
  return run(binary(), args, paths.steamCmd(), context);
}

export async function installOrUpdate(world: WorldView, context: JobContext): Promise<void> {
  await ensureSteamCmd(context);
  await mkdir(world.installDir, { recursive: true });
  const before = readBuildId(world);
  await context.update(10, before ? "Updating server" : "Installing server");
  let result = await invoke(world, context);
  const denied = /Failed to get manifest request code.*Access Denied/i.test(result.output);
  if (result.code !== 0 && denied && existsSync(manifestPath(world))) {
    const preserved = `${manifestPath(world)}.failed-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    renameSync(manifestPath(world), preserved);
    context.log(`Preserved denied manifest as ${path.basename(preserved)}; retrying with fresh metadata.`);
    result = await invoke(world, context);
  }
  const buildId = readBuildId(world);
  const successMarker = /Success! App '2394010' fully installed/i.test(result.output);
  const executable = path.join(world.installDir, world.platform === "windows" ? "PalServer.exe" : "PalServer.sh");
  if (!existsSync(executable) || !buildId || (result.code !== 0 && !successMarker && buildId === before)) {
    const reason = result.output.match(/Error![^\r\n]*/i)?.[0] ?? `SteamCMD exited with code ${result.code}`;
    throw new Error(redact(reason));
  }
  await database().update(worlds).set({ buildId, updatedAt: Date.now() }).where(eq(worlds.id, world.id));
  await context.update(100, `Installed build ${buildId}`);
}
