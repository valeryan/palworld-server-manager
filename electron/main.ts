import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, powerSaveBlocker, shell, Tray } from "electron";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { desktopIconPath } from "./desktop-icon";
import { isSupersededNavigation } from "./navigation";
import { defaultLaunchAtLoginOptions, defaultManagerPort, launchAtLoginArguments, normalizeLaunchAtLoginOptions, normalizeManagerPort, parseCustomLaunchFlags, validateManagerPort, type LaunchAtLoginOptions } from "./launch-options";
import { runDatabasePreflight, UpgradePreflightError, type PreflightOptions, type UpgradeStage } from "../src/server/db/upgrade";
import { migrationDigest } from "../src/server/db/migration-catalog";
import { compareSemanticVersions } from "../src/lib/semver";
import { assertLocalWindowsPath } from "../src/server/host";

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

const isDev = Boolean(process.env.ELECTRON_START_URL); const developmentUrl = isDev ? new URL(process.env.ELECTRON_START_URL!) : null; const token = randomBytes(32).toString("hex");
const launchSession = randomBytes(24).toString("hex");
let quitDrained = false; let drainingQuit = false; let profileError: unknown;
const startHidden = process.argv.includes("--hidden");
let window: BrowserWindow | null = null; let upgradeWindow: BrowserWindow | null = null; let upgradeCloseBlocked = false; let tray: Tray | null = null; let server: ChildProcess | null = null; let serverFailure: string | null = null; let quitting = false;
if (isDev && process.env.PALWORLD_MANAGER_DATA_DIR) { const developmentProfile = path.resolve(process.env.PALWORLD_MANAGER_DATA_DIR, "electron"); mkdirSync(developmentProfile, { recursive: true }); app.setPath("userData", developmentProfile); }
else if (process.env.PORTABLE_EXECUTABLE_DIR) { const portable = path.join(process.env.PORTABLE_EXECUTABLE_DIR, "PSM-Data"); try { mkdirSync(portable, { recursive: true }); app.setPath("userData", portable); } catch (error) { profileError = error; } }
const dataDir = () => app.getPath("userData"); const log = (message: string) => { try { appendFileSync(path.join(dataDir(), "launcher-v3.log"), `[${new Date().toISOString()}] ${message}\n`); } catch {} };
const preferencePath = () => path.join(dataDir(), "desktop-preferences.json");
type ManagerHost = "127.0.0.1" | "0.0.0.0";
type DesktopPreferences = { lastLoginExecutable: string | null; closeToTray: boolean; launchAtLogin: boolean; launchOptions: LaunchAtLoginOptions; managerPort: number; managerHost: ManagerHost; lastSuccessfulAppVersion: string | null };
function normalizeManagerHost(value: unknown): ManagerHost { return value === "0.0.0.0" ? value : "127.0.0.1"; }
function preferences(): DesktopPreferences { try { const saved = JSON.parse(readFileSync(preferencePath(), "utf8")); return { lastLoginExecutable: typeof saved.lastLoginExecutable === "string" ? saved.lastLoginExecutable : null, closeToTray: saved.closeToTray !== false, launchAtLogin: saved.launchAtLogin === true || (saved.launchAtLogin == null && process.platform === "linux" && existsSync(linuxAutostartPath())), launchOptions: normalizeLaunchAtLoginOptions(saved.launchOptions), managerPort: normalizeManagerPort(saved.managerPort), managerHost: normalizeManagerHost(saved.managerHost), lastSuccessfulAppVersion: typeof saved.lastSuccessfulAppVersion === "string" ? saved.lastSuccessfulAppVersion : null }; } catch { return { lastLoginExecutable: null, closeToTray: true, launchAtLogin: process.platform === "linux" && existsSync(linuxAutostartPath()), launchOptions: defaultLaunchAtLoginOptions, managerPort: defaultManagerPort, managerHost: "127.0.0.1", lastSuccessfulAppVersion: null }; } }
function writePreferences(patch: Partial<DesktopPreferences>) { mkdirSync(dataDir(), { recursive: true }); const temporary = `${preferencePath()}.tmp-${process.pid}`; writeFileSync(temporary, JSON.stringify({ ...preferences(), ...patch }, null, 2), { mode: 0o600 }); renameSync(temporary, preferencePath()); }
const port = developmentUrl ? validateManagerPort(developmentUrl.port || "80") : process.env.PSM_PORT ? validateManagerPort(process.env.PSM_PORT) : preferences().managerPort;
function remoteAccessEnabled(): boolean { try { return JSON.parse(readFileSync(path.join(dataDir(), "remote-access.json"), "utf8")).enabled === true; } catch { return false; } }
const host: ManagerHost = process.env.PSM_HOST === "0.0.0.0" ? "0.0.0.0" : remoteAccessEnabled() ? preferences().managerHost : "127.0.0.1";
function linuxAutostartPath() { return path.join(app.getPath("home"), ".config", "autostart", "com.palworld.servermanager.next.desktop"); }
function persistentDataArguments() { return process.argv.slice(1).filter((argument) => argument.startsWith("--user-data-dir=")); }
function desktopQuote(value: string) { return `"${value.replace(/([\\`"$])/g, "\\$1")}"`; }
function autostartContents(): string { const executable = process.env.APPIMAGE || process.execPath; const launchArguments = launchAtLoginArguments({ ...preferences().launchOptions, forceX11: process.platform === "linux" && preferences().launchOptions.forceX11 }, persistentDataArguments()); const command = [executable, ...launchArguments].map(desktopQuote).join(" "); return `[Desktop Entry]\nType=Application\nName=Palworld Server Manager Next\nComment=Start the Palworld server supervisor at login\nExec=${command}\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`; }
function atomicWrite(filePath: string, content: string) { mkdirSync(path.dirname(filePath), { recursive: true }); const temporary = `${filePath}.tmp-${process.pid}`; writeFileSync(temporary, content, { mode: 0o600 }); renameSync(temporary, filePath); }
function updatedAutostartContents(content: string): string {
  const executable = process.env.APPIMAGE || process.execPath;
  const command = /^Exec=(?:"(?:\\.|[^"\\])*"|\S+)(.*)$/m.exec(content);
  if (!command) throw new Error("The managed launch-at-login entry has no replaceable Exec command.");
  return content.replace(command[0], () => `Exec=${desktopQuote(executable)}${command[1]}`);
}
function loginExecutable(): string { return process.env.PORTABLE_EXECUTABLE_FILE || (process.env.PORTABLE_EXECUTABLE_DIR && process.env.PORTABLE_EXECUTABLE_APP_FILENAME ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, process.env.PORTABLE_EXECUTABLE_APP_FILENAME) : process.execPath); }
function loginStatus() {
  if (process.platform !== "win32") return { configured: preferences().launchAtLogin, enabled: preferences().launchAtLogin, disabledByOS: false };
  const state = app.getLoginItemSettings({ path: loginExecutable(), args: launchAtLoginArguments({ ...preferences().launchOptions, forceX11: false }, persistentDataArguments()) });
  return { configured: state.openAtLogin, enabled: state.openAtLogin && state.executableWillLaunchAtLogin, disabledByOS: state.openAtLogin && !state.executableWillLaunchAtLogin };
}
function setLaunchAtLogin(enabled: boolean, preserveApproval = false): boolean {
  if (isDev) throw new Error("Launch at login is only available in the packaged application.");
  const launchArguments = launchAtLoginArguments({ ...preferences().launchOptions, forceX11: process.platform === "linux" && preferences().launchOptions.forceX11 }, persistentDataArguments());
  if (process.platform === "linux") {
    const filePath = linuxAutostartPath(); mkdirSync(path.dirname(filePath), { recursive: true });
    if (enabled) {
      atomicWrite(filePath, autostartContents());
    } else rmSync(filePath, { force: true });
  } else {
    const approved = enabled && (!preserveApproval || app.getLoginItemSettings({ path: preferences().lastLoginExecutable ?? loginExecutable() }).executableWillLaunchAtLogin);
    app.setLoginItemSettings({ openAtLogin: enabled, enabled: approved, path: loginExecutable(), args: launchArguments });
  }
  writePreferences({ launchAtLogin: enabled, lastLoginExecutable: loginExecutable() }); return enabled;
}
function preflightOptions(): PreflightOptions { return { databasePath: path.join(dataDir(), "registry-v3.sqlite"), dataDirectory: dataDir(), migrationsFolder: path.join(process.resourcesPath, "app", "drizzle") }; }

const upgradeStyles = `body{margin:0;background:#07101e;color:#eaf8ff;font:15px system-ui;display:grid;place-items:center;min-height:100vh}.card{width:430px;max-width:calc(100vw - 64px)}h1{font-size:24px;margin:0 0 10px}p{color:#8da9bc;line-height:1.55}.actions{display:flex;justify-content:flex-end;gap:10px;margin-top:26px}button{border:1px solid #365777;border-radius:8px;padding:10px 16px;background:#162842;color:#eaf8ff;font:inherit}button.primary{background:#31c4fe;color:#06121b;border-color:#31c4fe;font-weight:800}.bar{height:7px;background:#162842;border-radius:10px;overflow:hidden;margin-top:24px}.bar i{display:block;height:100%;background:#31c4fe;transition:width .2s}.version{font:12px ui-monospace,monospace;color:#31c4fe}`;
const upgradePage = (body: string) => `data:text/html,${encodeURIComponent(`<meta charset="utf-8"><title>Palworld Server Manager upgrade</title><style>${upgradeStyles}</style><main class="card">${body}</main>`)}`;
async function confirmVersionTransition(previous: string | null, current: string, downgrade: boolean): Promise<boolean> {
  const heading = downgrade ? `Downgrade to ${current}?` : previous ? `Upgrade to ${current}?` : `Upgrade existing installation to ${current}?`;
  const detail = downgrade ? `This installation last started successfully with ${previous}. Continue only if you intentionally selected an older application. Database compatibility will be checked before startup.` : `The manager will safely prepare local data and update an existing launch-at-login entry before starting ${current}.`;
  upgradeWindow = new BrowserWindow({ width: 540, height: 360, resizable: false, maximizable: false, fullscreenable: false, autoHideMenuBar: true, backgroundColor: "#07101e", title: "Palworld Server Manager upgrade", webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  upgradeWindow.on("close", (event) => { if (upgradeCloseBlocked && !quitting) event.preventDefault(); });
  await upgradeWindow.loadURL(upgradePage(`<h1>${heading}</h1><p>${detail}</p><p class="version">${previous ?? "existing installation"} → ${current}</p><div class="actions"><button onclick="location.href='psm-upgrade://quit'">Quit</button><button class="primary" onclick="location.href='psm-upgrade://confirm'">${downgrade ? "Continue downgrade" : "Upgrade"}</button></div>`));
  return await new Promise<boolean>((resolve) => {
    let settled = false;
    const activeWindow = upgradeWindow!;
    const navigate = (event: Electron.Event, url: string) => { if (!url.startsWith("psm-upgrade://")) return; event.preventDefault(); finish(url === "psm-upgrade://confirm"); };
    const closed = () => finish(false);
    const finish = (value: boolean) => { if (settled) return; settled = true; activeWindow.webContents.removeListener("will-navigate", navigate); activeWindow.removeListener("closed", closed); resolve(value); };
    activeWindow.webContents.on("will-navigate", navigate);
    activeWindow.once("closed", closed);
  });
}
async function showUpgradeProgress(stage: UpgradeStage | "starting"): Promise<void> {
  if (!upgradeWindow || upgradeWindow.isDestroyed()) return;
  upgradeCloseBlocked = true;
  const stages: Record<typeof stage, [string, number]> = { preparing: ["Preparing upgrade…", 12], "backing-up": ["Backing up manager data…", 28], "updating-autostart": ["Updating launch-at-login…", 44], migrating: ["Migrating database…", 62], verifying: ["Verifying manager data…", 78], starting: [`Starting version ${app.getVersion()}…`, 90] };
  const [message, percent] = stages[stage]; upgradeWindow.setClosable(false);
  await upgradeWindow.loadURL(upgradePage(`<h1>${message}</h1><p>Please keep this application open while local data is prepared.</p><div class="bar"><i style="width:${percent}%"></i></div><p class="version">Version ${app.getVersion()}</p>`));
}
async function showUpgradeCompletion(): Promise<boolean> {
  if (!upgradeWindow || upgradeWindow.isDestroyed()) return false;
  const activeWindow = upgradeWindow;
  upgradeCloseBlocked = true;
  let finish!: (value: boolean) => void;
  const continued = new Promise<boolean>((resolve) => {
    let settled = false;
    const navigate = (event: Electron.Event, url: string) => { if (!url.startsWith("psm-upgrade://")) return; event.preventDefault(); finish(url === "psm-upgrade://continue"); };
    const closed = () => finish(false);
    finish = (value: boolean) => { if (settled) return; settled = true; if (value) upgradeCloseBlocked = false; activeWindow.webContents.removeListener("will-navigate", navigate); activeWindow.removeListener("closed", closed); resolve(value); };
    activeWindow.webContents.on("will-navigate", navigate);
    activeWindow.once("closed", closed);
  });
  try { await activeWindow.loadURL(upgradePage(`<h1>Upgrade complete</h1><p>Version ${app.getVersion()} is ready. Continue to open Palworld Server Manager.</p><div class="bar"><i style="width:100%"></i></div><p class="version">Version ${app.getVersion()}</p><div class="actions"><button class="primary" onclick="location.href='psm-upgrade://continue'">Continue</button></div>`)); }
  catch { finish(false); }
  return await continued;
}
function restoreAutostart(filePath: string, content: string | null): void { if (content === null) rmSync(filePath, { force: true }); else atomicWrite(filePath, content); }

async function activatePackagedVersion(): Promise<void> {
  const current = app.getVersion(); const saved = preferences().lastSuccessfulAppVersion; const databaseExists = existsSync(preflightOptions().databasePath);
  const comparison = saved ? compareSemanticVersions(current, saved) : databaseExists ? 1 : 0;
  const transition = databaseExists && (!saved || comparison !== 0);
  if (transition && !await confirmVersionTransition(saved, current, comparison !== null && comparison < 0)) { quitting = true; app.quit(); throw new Error("Application upgrade was cancelled."); }
  if (transition) await showUpgradeProgress("preparing");
  const autostart = process.platform === "linux" ? linuxAutostartPath() : null;
  const previousAutostart = autostart && existsSync(autostart) ? readFileSync(autostart, "utf8") : null; let autostartChanged = false;
  try {
    const result = await runDatabasePreflight({ ...preflightOptions(), onProgress: transition ? showUpgradeProgress : undefined, beforeMigrate: async () => {
      if (!autostart || previousAutostart === null) return;
      if (transition) await showUpgradeProgress("updating-autostart"); atomicWrite(autostart, updatedAutostartContents(previousAutostart)); autostartChanged = true;
    } });
    log(`Database preflight complete (${result.result}, schema ${result.schemaHead ?? "none"}, backup ${result.backupPath ?? "not needed"})`);
  } catch (error) {
    if (autostart && autostartChanged) { try { restoreAutostart(autostart, previousAutostart); } catch (restoreError) { log(`Could not restore launch-at-login entry: ${String(restoreError)}`); } }
    throw error;
  }
}

function startServer() {
  if (isDev) { log(`Using development renderer: ${process.env.ELECTRON_START_URL}`); return; }
  serverFailure = null;
  const root = path.join(process.resourcesPath, "app"); const entry = path.join(root, "server.js");
  log(`Starting bundled web server from ${entry}`);
  if (!existsSync(entry)) throw new Error(`Bundled Next server is missing: ${entry}`);
  const serverModules = path.join(root, "server-node_modules");
  const nodePath = [serverModules, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
  server = spawn(process.execPath, [entry], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", NODE_ENV: "production", NODE_PATH: nodePath, HOSTNAME: host, PORT: String(port), PSM_ADMIN_TOKEN: token, PSM_LAUNCH_SESSION: launchSession, PSM_APP_VERSION: app.getVersion(), ...(app.isPackaged ? { PSM_PACKAGED: "1" } : {}), PSM_DATABASE_PREFLIGHTED: migrationDigest(), PALWORLD_MANAGER_DATA_DIR: dataDir() } });
  log(`Bundled web server process created (pid ${server.pid ?? "unknown"})`);
  server.stdout?.on("data", (data) => log(`[web] ${String(data).trim()}`)); server.stderr?.on("data", (data) => log(`[web:error] ${String(data).trim()}`));
  server.on("error", (error) => { serverFailure = error.message; log(`Web server error: ${error.message}`); }); server.on("exit", (code) => { if (!quitting) serverFailure = `The bundled web server exited during startup (${code ?? "unknown status"}). The manager port ${port} may already be in use.`; log(`Web server exited: ${code}`); });
}
async function stopServer(): Promise<void> {
  const child = server; if (!child) return; server = null;
  if (child.exitCode !== null || child.signalCode) return;
  await new Promise<void>((resolve) => { const forced = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 2_000); child.once("exit", () => { clearTimeout(forced); resolve(); }); try { child.kill("SIGTERM"); } catch { clearTimeout(forced); resolve(); } });
}

async function runtimeRequest(route: string, method = "GET"): Promise<Record<string, unknown>> {
  const response = await fetch(`http://127.0.0.1:${port}/api/runtime/${route}`, { method, redirect: "error", signal: AbortSignal.timeout(2_000), headers: { cookie: `psm_admin=${token}`, "x-psm-launch-session": launchSession } });
  if (!response.ok) throw new Error(`Runtime ${route}: HTTP ${response.status}`);
  const body = await response.json(); if (!body.ok || body.session !== launchSession) throw new Error("Runtime session did not match this launcher."); return body;
}
async function ping(): Promise<boolean> {
  try { if (developmentUrl) { const response = await fetch(developmentUrl, { signal: AbortSignal.timeout(1_000), redirect: "manual" }); return response.status >= 200 && response.status < 400; } await runtimeRequest("ready"); return true; } catch { return false; }
}
async function drainAndQuit(): Promise<void> {
  if (drainingQuit) return; drainingQuit = true;
  try {
    if (server && server.exitCode === null && !serverFailure) {
      window?.setTitle("Finishing operations before quitting…");
      while (true) { const state = await runtimeRequest("drain", "POST"); if (state.active === 0) break; await new Promise((resolve) => setTimeout(resolve, 500)); }
    }
    await stopServer(); quitDrained = true; app.quit();
  } catch (error) { drainingQuit = false; quitting = false; log(`Quit delayed: ${String(error)}`); await dialog.showMessageBox({ type: "error", message: "The manager could not finish shutting down safely.", detail: `${String(error)}\nInspect Operations and retry Quit. Running servers have not been stopped.` }); }
}

async function waitForServer() { const deadline = Date.now() + 60_000; while (Date.now() < deadline) { if (serverFailure) throw new Error(serverFailure); if (await ping()) return; await new Promise((resolve) => setTimeout(resolve, 350)); } throw new Error(`The bundled web server did not answer on port ${port} within 60 seconds.`); }
function iconPath() { return desktopIconPath({ isDevelopment: isDev, platform: process.platform, developmentRoot: path.join(__dirname, ".."), resourcesPath: process.resourcesPath }); }

async function createWindow(show = true) {
  if (window) { if (show) { window.show(); window.focus(); } return; }
  const created = new BrowserWindow({ width: 1360, height: 860, minWidth: 960, minHeight: 640, show: false, backgroundColor: "#0b0d12", autoHideMenuBar: true, title: "Palworld Server Manager", icon: iconPath(), webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  window = created;
  Menu.setApplicationMenu(null); created.setMenuBarVisibility(false);
  created.webContents.on("did-fail-load", (_event, code, description, url, mainFrame) => { if (mainFrame) log(`Renderer failed ${url}: ${code} ${description}`); });
  created.webContents.on("render-process-gone", (_event, details) => log(`Renderer gone: ${details.reason} (${details.exitCode})`));
  created.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: "deny" }; });
  created.on("close", (event) => { if (!quitting && tray && preferences().closeToTray) { event.preventDefault(); created.hide(); } });
  created.on("query-session-end", () => { quitting = true; void runtimeRequest("drain", "POST").catch((error) => log(`Session-end drain: ${String(error)}`)); });
  created.on("session-end", () => { quitDrained = true; void stopServer(); });
  created.on("closed", () => { if (window === created) window = null; });
  if (show) created.once("ready-to-show", () => { if (!created.isDestroyed()) { created.show(); created.focus(); } });
  const url = developmentUrl?.toString() || `http://127.0.0.1:${port}`;
  await created.webContents.session.cookies.set({ url: developmentUrl?.origin || `http://127.0.0.1:${port}`, name: "psm_admin", value: token, httpOnly: true, sameSite: "lax" });
  try {
    await created.loadURL(url);
  } catch (error) {
    if (!isSupersededNavigation(error) || created.isDestroyed()) throw error;
    log(`Initial renderer navigation was superseded; continuing with ${created.webContents.getURL() || "the replacement route"}`);
  }
}

function createTray() { try { tray = new Tray(nativeImage.createFromPath(iconPath())); tray.setToolTip("Palworld Server Manager"); tray.setContextMenu(Menu.buildFromTemplate([{ label: "Open", click: () => void createWindow() }, { type: "separator" }, { label: "Quit", click: () => { quitting = true; app.quit(); } }])); tray.on("click", () => void createWindow()); } catch (error) { log(`Tray unavailable: ${String(error)}`); } }
ipcMain.handle("pick-directory", async () => { const result = await dialog.showOpenDialog(window!, { properties: ["openDirectory", "createDirectory"] }); return result.canceled ? null : result.filePaths[0]; });
ipcMain.handle("pick-zip", async () => { const result = await dialog.showOpenDialog(window!, { properties: ["openFile"], filters: [{ name: "Zip archives", extensions: ["zip"] }] }); return result.canceled ? null : result.filePaths[0]; });
ipcMain.handle("pick-registration", async () => { const result = await dialog.showOpenDialog(window!, { properties: ["openFile"], filters: [{ name: "PSM Next registration", extensions: ["json"] }] }); const filePath = result.filePaths[0]; if (result.canceled || !filePath) return null; if (statSync(filePath).size > 1_048_576) throw new Error("Registration files must be smaller than 1 MiB."); return { fileName: path.basename(filePath), content: readFileSync(filePath, "utf8") }; });
ipcMain.handle("save-registration", async (_event, defaultName: string, content: string) => { if (Buffer.byteLength(content, "utf8") > 1_048_576) throw new Error("Registration files must be smaller than 1 MiB."); const safeName = path.basename(defaultName).replace(/[^a-zA-Z0-9._-]/g, "-"); const result = await dialog.showSaveDialog(window!, { defaultPath: safeName, filters: [{ name: "PSM Next registration", extensions: ["json"] }] }); if (result.canceled || !result.filePath) return null; writeFileSync(result.filePath, content, { mode: 0o600 }); return result.filePath; });
ipcMain.handle("open-path", (_event, target: string) => shell.openPath(target)); ipcMain.handle("get-theme", () => nativeTheme.shouldUseDarkColors ? "dark" : "light"); ipcMain.handle("get-locale", () => app.getLocale() || "en");
ipcMain.handle("get-close-to-tray", () => preferences().closeToTray); ipcMain.handle("set-close-to-tray", (_event, enabled: boolean) => { writePreferences({ closeToTray: Boolean(enabled) }); return Boolean(enabled); });
ipcMain.handle("get-launch-at-login", () => loginStatus().configured); ipcMain.handle("get-login-status", () => loginStatus()); ipcMain.handle("set-launch-at-login", (_event, enabled: boolean) => setLaunchAtLogin(Boolean(enabled)));
ipcMain.handle("get-launch-at-login-options", () => preferences().launchOptions);
ipcMain.handle("set-launch-at-login-options", (_event, value: unknown) => {
  const launchOptions = normalizeLaunchAtLoginOptions(value); if (process.platform === "win32") { launchOptions.forceX11 = false; if (launchOptions.customFlags !== preferences().launchOptions.customFlags) launchOptions.argumentFormat = "windows"; } parseCustomLaunchFlags(launchOptions.customFlags, launchOptions.argumentFormat); writePreferences({ launchOptions });
  if (preferences().launchAtLogin) setLaunchAtLogin(true, true);
  return launchOptions;
});
ipcMain.handle("get-manager-port", () => ({ configured: preferences().managerPort, active: port }));
ipcMain.handle("set-manager-port", (_event, value: unknown) => { const managerPort = validateManagerPort(value); writePreferences({ managerPort }); return { configured: managerPort, active: port, restartRequired: managerPort !== port }; });
ipcMain.handle("get-manager-network", () => ({ configuredHost: preferences().managerHost, activeHost: host, port, addresses: Object.values(networkInterfaces()).flat().filter((entry) => entry?.family === "IPv4" && !entry.internal).map((entry) => entry!.address) }));
ipcMain.handle("set-manager-host", (_event, value: unknown) => { const managerHost = normalizeManagerHost(value); if (managerHost === "0.0.0.0" && !remoteAccessEnabled()) throw new Error("Enable authenticated remote access before allowing LAN connections."); writePreferences({ managerHost }); return { configuredHost: managerHost, activeHost: host, restartRequired: managerHost !== host }; });
const ownsInstanceLock = app.requestSingleInstanceLock();
if (!ownsInstanceLock) app.quit(); else {
  app.on("second-instance", () => { if (upgradeWindow && !upgradeWindow.isDestroyed()) { upgradeWindow.show(); upgradeWindow.focus(); } else void createWindow(); });
  app.whenReady().then(async () => {
    try {
      if (profileError) throw profileError;
      assertLocalWindowsPath(dataDir()); mkdirSync(dataDir(), { recursive: true }); assertLocalWindowsPath(realpathSync(dataDir())); log(`Desktop ready (data ${dataDir()}, bind ${host}:${port}, AppImage ${Boolean(process.env.APPIMAGE)}, hidden ${startHidden})`); powerSaveBlocker.start("prevent-app-suspension");
      if (!isDev) await activatePackagedVersion();
      if (upgradeWindow && !upgradeWindow.isDestroyed()) await showUpgradeProgress("starting");
      startServer(); await waitForServer(); log("Bundled web server is ready");
      if (!isDev) { writePreferences({ lastSuccessfulAppVersion: app.getVersion() }); if (process.platform === "win32" && preferences().launchAtLogin) setLaunchAtLogin(true, true); }
      if (upgradeWindow && !upgradeWindow.isDestroyed() && !await showUpgradeCompletion()) { quitting = true; await stopServer(); app.quit(); return; }
      createTray(); await createWindow(!startHidden);
      if (upgradeWindow && !upgradeWindow.isDestroyed()) { upgradeWindow.destroy(); upgradeWindow = null; }
      log(startHidden ? "Main window loaded hidden" : "Main window loaded");
    } catch (error) {
      if (quitting) return; await stopServer().catch(() => undefined); if (upgradeWindow && !upgradeWindow.isDestroyed()) upgradeWindow.destroy(); upgradeWindow = null;
      const failure = error instanceof UpgradePreflightError ? error : null; const message = error instanceof Error ? error.message : String(error); log(`${message}${failure?.causeDetail ? ` ${failure.causeDetail}` : ""}`);
      const response = await dialog.showMessageBox({ type: "error", title: "Palworld Server Manager could not start", message, detail: `${failure?.causeDetail ? `${failure.causeDetail}\n\n` : ""}Database: ${failure?.databasePath ?? preflightOptions().databasePath}\nBackup: ${failure?.backupPath ?? "No upgrade backup was needed"}\nLog: ${path.join(dataDir(), "launcher-v3.log")}`, buttons: ["Open backup folder", "Open launcher log", "Quit"], defaultId: 2, cancelId: 2, noLink: true });
      if (response.response === 0) await shell.openPath(dataDir()); else if (response.response === 1) await shell.openPath(path.join(dataDir(), "launcher-v3.log")); quitting = true; app.quit();
    }
  });
  app.on("before-quit", (event) => { quitting = true; if (!quitDrained && server) { event.preventDefault(); void drainAndQuit(); return; } tray?.destroy(); upgradeWindow?.destroy(); upgradeWindow = null; });
  app.on("window-all-closed", () => { if (!preferences().closeToTray || !tray) app.quit(); });
}
