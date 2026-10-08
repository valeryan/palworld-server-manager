import { app, dialog, powerSaveBlocker, shell } from "electron";
import { mkdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { assertLocalWindowsPath } from "../src/server/host";
import { UpgradePreflightError } from "../src/server/db/upgrade";
import { setLaunchAtLogin } from "./autostart";
import { bindPort, host, port } from "./binding";
import { dataDir, isDev, launcherLogPath, log, profileSetupError, quitState, startHidden } from "./environment";
import { registerIpcHandlers } from "./ipc";
import { preferences, writePreferences } from "./preferences";
import { runtimeRequest, serverGone, serverHealthy, serverStarted, startServer, stopServer, waitForServer } from "./server-process";
import { activatePackagedVersion, preflightOptions } from "./upgrade";
import { destroyUpgradeWindow, focusUpgradeWindow, showUpgradeCompletion, showUpgradeProgress, upgradeWindowOpen } from "./upgrade-ui";
import { createTray, createWindow, destroyTray, mainWindow, trayAvailable } from "./window";

// Composition root for the desktop shell: Chromium switches, single-instance handling, the startup
// sequence (profile, upgrade preflight, bundled server, window) and the drain-before-quit flow.

app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
if (process.platform === "linux") app.commandLine.appendSwitch("disable-dev-shm-usage");

function sandboxNeedsCompatibility(): boolean {
  if (process.platform !== "linux" || typeof process.getuid !== "function") return false;
  if (process.getuid() === 0 || Boolean(process.env.APPIMAGE)) return true;
  try { const helper = path.join(path.dirname(process.execPath), "chrome-sandbox"); const info = statSync(helper); return info.uid !== 0 || (info.mode & 0o4000) === 0; }
  catch { return false; }
}
if (sandboxNeedsCompatibility()) { app.commandLine.appendSwitch("no-sandbox"); app.commandLine.appendSwitch("no-zygote"); }

registerIpcHandlers();

/** Waits for in-flight operations to finish before stopping the server and quitting. */
async function drainAndQuit(): Promise<void> {
  if (quitState.drainingQuit) return; quitState.drainingQuit = true;
  try {
    if (serverHealthy()) {
      mainWindow()?.setTitle("Finishing operations before quitting…");
      while (true) { const state = await runtimeRequest("drain", "POST"); if (state.active === 0) break; await new Promise((resolve) => setTimeout(resolve, 500)); }
    }
    await stopServer(); quitState.quitDrained = true; app.quit();
  } catch (error) {
    // A drain request fails when the web server has already died (its exit may still be being
    // reported); there is nothing left to drain, so quit instead of showing the dialog meant for a
    // live server that refuses to finish.
    if (await serverGone(2_000)) { log(`Quitting after the web server exited: ${String(error)}`); await stopServer().catch(() => undefined); quitState.quitDrained = true; app.quit(); return; }
    quitState.drainingQuit = false; quitState.quitting = false; log(`Quit delayed: ${String(error)}`); await dialog.showMessageBox({ type: "error", message: "The manager could not finish shutting down safely.", detail: `${String(error)}\nInspect Operations and retry Quit. Running servers have not been stopped.` }); }
}

async function reportStartupFailure(error: unknown): Promise<void> {
  await stopServer().catch(() => undefined); destroyUpgradeWindow();
  const failure = error instanceof UpgradePreflightError ? error : null; const message = error instanceof Error ? error.message : String(error); log(`${message}${failure?.causeDetail ? ` ${failure.causeDetail}` : ""}`);
  const response = await dialog.showMessageBox({ type: "error", title: "Palworld Server Manager could not start", message, detail: `${failure?.causeDetail ? `${failure.causeDetail}\n\n` : ""}Database: ${failure?.databasePath ?? preflightOptions().databasePath}\nBackup: ${failure?.backupPath ?? "No upgrade backup was needed"}\nLog: ${launcherLogPath()}`, buttons: ["Open backup folder", "Open launcher log", "Quit"], defaultId: 2, cancelId: 2, noLink: true });
  if (response.response === 0) await shell.openPath(dataDir()); else if (response.response === 1) await shell.openPath(launcherLogPath()); quitState.quitting = true; app.quit();
}

async function start(): Promise<void> {
  const profileError = profileSetupError(); if (profileError) throw profileError;
  assertLocalWindowsPath(dataDir()); mkdirSync(dataDir(), { recursive: true }); assertLocalWindowsPath(realpathSync(dataDir())); await bindPort(); log(`Desktop ready (data ${dataDir()}, bind ${host}:${port()}, AppImage ${Boolean(process.env.APPIMAGE)}, hidden ${startHidden})`); powerSaveBlocker.start("prevent-app-suspension");
  if (!isDev) await activatePackagedVersion();
  if (upgradeWindowOpen()) await showUpgradeProgress("starting");
  await startServer(); await waitForServer(); log("Bundled web server is ready");
  if (!isDev) { writePreferences({ lastSuccessfulAppVersion: app.getVersion() }); if (process.platform === "win32" && preferences().launchAtLogin) setLaunchAtLogin(true, true); }
  if (upgradeWindowOpen() && !await showUpgradeCompletion()) { quitState.quitting = true; await stopServer(); app.quit(); return; }
  createTray(); await createWindow(!startHidden);
  destroyUpgradeWindow();
  log(startHidden ? "Main window loaded hidden" : "Main window loaded");
}

const ownsInstanceLock = app.requestSingleInstanceLock();
if (!ownsInstanceLock) app.quit(); else {
  app.on("second-instance", () => { if (upgradeWindowOpen()) focusUpgradeWindow(); else void createWindow(); });
  app.whenReady().then(async () => {
    try { await start(); }
    catch (error) { if (quitState.quitting) return; await reportStartupFailure(error); }
  });
  app.on("before-quit", (event) => { quitState.quitting = true; if (!quitState.quitDrained && serverStarted()) { event.preventDefault(); void drainAndQuit(); return; } destroyTray(); destroyUpgradeWindow(); });
  app.on("window-all-closed", () => { if (!preferences().closeToTray || !trayAvailable()) app.quit(); });
}
