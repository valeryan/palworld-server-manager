import { hostPlatform } from "@/server/host";
import "server-only";
import path from "node:path";
import { spawn } from "node:child_process";
import { mkdir, readdir, readFile } from "node:fs/promises";
import type { WorldView } from "@/contracts/world";
import { exists } from "@/server/fs";
import { paths } from "@/server/paths";

type WineWorld = Pick<WorldView, "id" | "platform" | "wineBinary" | "winePrefix">;
const HEADLESS_DRIVER = /^\s*"Graphics"\s*=\s*"null"\s*$/m;

// Never let a server prefix register menu entries or file associations on the host desktop.
const NO_DESKTOP_INTEGRATION = "winemenubuilder.exe=d";
export function serverWineOverrides(current: string | undefined): string { return withWineOverrides(current, NO_DESKTOP_INTEGRATION); }
export function withWineOverrides(current: string | undefined, ...overrides: string[]): string { return [current, ...overrides].filter(Boolean).join(";"); }

export function runsUnderWine(world: Pick<WorldView, "platform">, host = hostPlatform()): boolean { return world.platform === "windows" && host !== "win32"; }

// Worlds without an explicit prefix get their own manager-owned prefix instead of ~/.wine.
export function effectiveWinePrefix(world: WineWorld): string { return world.winePrefix?.trim() || paths.winePrefix(world.id); }
export function managesWinePrefix(world: WineWorld): boolean { return !world.winePrefix?.trim() || path.resolve(world.winePrefix) === path.resolve(paths.winePrefix(world.id)); }

function run(command: string, args: string[], env: NodeJS.ProcessEnv, log: (line: string) => void, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`${path.basename(command)} ${args.join(" ")} timed out.`)); }, timeoutMs);
    const forward = (chunk: Buffer) => { for (const line of chunk.toString().split(/\r?\n/)) if (line.trim()) log(line); };
    child.stdout.on("data", forward); child.stderr.on("data", forward);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("exit", (code) => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(`${path.basename(command)} ${args.join(" ")} exited with code ${code}.`)); });
  });
}

// A dedicated server must never raise Wine dialogs or windows. First-run prefix creation is
// done with Mono/Gecko disabled (no installer prompts) and no display, then the null graphics
// driver keeps the server console from opening a window. Only manager-owned prefixes are
// changed; a user-supplied prefix may be shared with other Wine programs.
// wineserver ships next to the wine launcher; a bare "wine" means both come from PATH.
export function wineserverFor(wineBinary: string): string { return wineBinary.includes(path.sep) ? path.join(/* turbopackIgnore: true */ path.dirname(wineBinary), "wineserver") : "wineserver"; }

export async function prepareWinePrefix(world: WineWorld, env: NodeJS.ProcessEnv, log: (line: string) => void): Promise<void> {
  if (!runsUnderWine(world)) return;
  const prefix = effectiveWinePrefix(world); const managed = managesWinePrefix(world);
  let changed = false;
  const quiet: NodeJS.ProcessEnv = { ...env, WINEPREFIX: prefix, WINEDEBUG: env.WINEDEBUG ?? "-all", WINEDLLOVERRIDES: withWineOverrides(env.WINEDLLOVERRIDES, "mscoree,mshtml=", NO_DESKTOP_INTEGRATION) };
  // Removing WAYLAND_DISPLAY is not enough: Wayland clients then fall back to the default
  // "wayland-0" socket and wineboot's "configuration is being updated" window still appears.
  delete quiet.DISPLAY; quiet.WAYLAND_DISPLAY = "psm-headless-no-display";
  if (!await exists(path.join(/* turbopackIgnore: true */ prefix, "system.reg"))) {
    if (!managed) log(`[manager] Wine prefix ${prefix} does not exist yet; creating it without installer prompts.`);
    else log(`[manager] Creating the Wine prefix for this world at ${prefix} (first start only).`);
    // Wine creates the prefix directory itself but not its parents.
    await mkdir(path.dirname(prefix), { recursive: true });
    await run(world.wineBinary, ["wineboot", "-i"], quiet, log, 300_000);
    changed = true;
  }
  const userRegistry = await readFile(path.join(/* turbopackIgnore: true */ prefix, "user.reg"), "utf8").catch(() => "");
  if (!HEADLESS_DRIVER.test(userRegistry)) {
    if (!managed) log(`[manager] Wine prefix ${prefix} is not headless; the server console may open a window. Set its graphics driver to "null" to prevent that.`);
    else {
      log("[manager] Configuring the Wine prefix to run without windows.");
      await run(world.wineBinary, ["reg", "add", "HKCU\\Software\\Wine\\Drivers", "/v", "Graphics", "/d", "null", "/f"], quiet, log, 120_000);
      changed = true;
    }
  }
  // The setup session started Wine's desktop without a display; letting it end before the
  // server launches makes the server start fresh with the saved null driver. Otherwise the
  // first start still opens a console window.
  if (changed) await run(wineserverFor(world.wineBinary), ["-w"], quiet, log, 120_000);
}

// Wine runs the game server outside the launcher's process tree, so signalling the launcher
// can leave the real server running. Finds this world's server processes by their prefix.
export async function wineServerProcesses(prefix: string): Promise<number[]> {
  const found: number[] = [];
  for (const entry of await readdir("/proc").catch(() => [] as string[])) {
    if (!/^\d+$/.test(entry)) continue;
    const command = await readFile(`/proc/${entry}/cmdline`, "utf8").catch(() => "");
    if (!/PalServer[^\0]*\.exe/i.test(command)) continue;
    const environment = await readFile(`/proc/${entry}/environ`, "utf8").catch(() => "");
    if (environment.split("\0").includes(`WINEPREFIX=${prefix}`)) found.push(Number(entry));
  }
  return found;
}

export async function stopWineServer(world: WineWorld & Pick<WorldView, "env">, force: boolean): Promise<number> {
  if (!runsUnderWine(world)) return 0;
  const prefix = world.env.WINEPREFIX ?? effectiveWinePrefix(world);
  const signal = (pids: number[], name: NodeJS.Signals) => { for (const pid of pids) { try { process.kill(pid, name); } catch { /* already gone */ } } };
  let remaining = await wineServerProcesses(prefix); const initial = remaining.length;
  if (!initial) return 0;
  signal(remaining, force ? "SIGKILL" : "SIGTERM");
  const deadline = Date.now() + (force ? 3_000 : 10_000);
  while ((remaining = await wineServerProcesses(prefix)).length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 250));
  signal(remaining, "SIGKILL");
  return initial;
}
