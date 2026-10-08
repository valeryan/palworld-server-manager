import { app } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { migrationDigest } from "../src/server/db/migration-catalog";
import { bindPort, host, port } from "./binding";
import { dataDir, developmentUrl, isDev, launchSession, log, quitState, token } from "./environment";

// The bundled Next.js server as a child process, and the authenticated runtime calls made to it.

let server: ChildProcess | null = null; let serverFailure: string | null = null;
export function serverStarted(): boolean { return server !== null; }
/** The server is up and has not reported a failure; a drain can be requested. */
export function serverHealthy(): boolean { return server !== null && server.exitCode === null && !serverFailure; }

export async function startServer() {
  await bindPort();
  if (isDev) { log(`Using development renderer: ${process.env.ELECTRON_START_URL}`); return; }
  serverFailure = null;
  const root = path.join(process.resourcesPath, "app"); const entry = path.join(root, "server.js");
  log(`Starting bundled web server from ${entry}`);
  if (!existsSync(entry)) throw new Error(`Bundled Next server is missing: ${entry}`);
  server = spawn(process.execPath, [entry], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", NODE_ENV: "production", HOSTNAME: host, PORT: String(port()), PSM_ADMIN_TOKEN: token, PSM_LAUNCH_SESSION: launchSession, PSM_APP_VERSION: app.getVersion(), ...(app.isPackaged ? { PSM_PACKAGED: "1" } : {}), PSM_DATABASE_PREFLIGHTED: migrationDigest(), PALWORLD_MANAGER_DATA_DIR: dataDir() } });
  log(`Bundled web server process created (pid ${server.pid ?? "unknown"})`);
  server.stdout?.on("data", (data) => log(`[web] ${String(data).trim()}`)); server.stderr?.on("data", (data) => log(`[web:error] ${String(data).trim()}`));
  server.on("error", (error) => { serverFailure = error.message; log(`Web server error: ${error.message}`); }); server.on("exit", (code) => { if (!quitState.quitting) serverFailure = `The bundled web server exited during startup (${code ?? "unknown status"}). The manager port ${port} may already be in use.`; log(`Web server exited: ${code}`); });
}

/** True once the bundled server has exited or failed, waiting up to `timeoutMs` for an exit that is still being reported. */
export function serverGone(timeoutMs: number): Promise<boolean> {
  const child = server;
  if (!child || !serverHealthy()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(!serverHealthy()), timeoutMs);
    const done = () => { clearTimeout(timer); resolve(true); };
    child.once("exit", done); child.once("error", done);
  });
}

export async function stopServer(): Promise<void> {
  const child = server; if (!child) return; server = null;
  if (child.exitCode !== null || child.signalCode) return;
  await new Promise<void>((resolve) => { const forced = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 2_000); child.once("exit", () => { clearTimeout(forced); resolve(); }); try { child.kill("SIGTERM"); } catch { clearTimeout(forced); resolve(); } });
}

export async function runtimeRequest(route: string, method = "GET"): Promise<Record<string, unknown>> {
  const response = await fetch(`http://127.0.0.1:${port()}/api/runtime/${route}`, { method, redirect: "error", signal: AbortSignal.timeout(2_000), headers: { cookie: `psm_admin=${token}`, "x-psm-launch-session": launchSession } });
  if (!response.ok) throw new Error(`Runtime ${route}: HTTP ${response.status}`);
  const body = await response.json(); if (!body.ok || body.session !== launchSession) throw new Error("Runtime session did not match this launcher."); return body;
}

async function ping(): Promise<boolean> {
  try { if (developmentUrl) { const response = await fetch(developmentUrl, { signal: AbortSignal.timeout(1_000), redirect: "manual" }); return response.status >= 200 && response.status < 400; } await runtimeRequest("ready"); return true; } catch { return false; }
}

export async function waitForServer() { const deadline = Date.now() + 60_000; while (Date.now() < deadline) { if (serverFailure) throw new Error(serverFailure); if (await ping()) return; await new Promise((resolve) => setTimeout(resolve, 350)); } throw new Error(`The bundled web server did not answer on port ${port} within 60 seconds.`); }
