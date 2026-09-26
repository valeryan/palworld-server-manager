import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, powerSaveBlocker, shell, Tray } from "electron";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { isSupersededNavigation } from "./navigation";
import { defaultLaunchAtLoginOptions, defaultManagerPort, launchAtLoginArguments, normalizeLaunchAtLoginOptions, normalizeManagerPort, parseCustomLaunchFlags, validateManagerPort, type LaunchAtLoginOptions } from "./launch-options";

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

const isDev = Boolean(process.env.ELECTRON_START_URL); const token = randomBytes(32).toString("hex");
const startHidden = process.argv.includes("--hidden");
let window: BrowserWindow | null = null; let tray: Tray | null = null; let server: ChildProcess | null = null; let serverFailure: string | null = null; let quitting = false;
if (isDev && process.env.PALWORLD_MANAGER_DATA_DIR) { const developmentProfile = path.resolve(process.env.PALWORLD_MANAGER_DATA_DIR, "electron"); mkdirSync(developmentProfile, { recursive: true }); app.setPath("userData", developmentProfile); }
else if (process.env.PORTABLE_EXECUTABLE_DIR) { const portable = path.join(process.env.PORTABLE_EXECUTABLE_DIR, "PSM-Data"); mkdirSync(portable, { recursive: true }); app.setPath("userData", portable); }
const dataDir = () => app.getPath("userData"); const log = (message: string) => { try { appendFileSync(path.join(dataDir(), "launcher-v3.log"), `[${new Date().toISOString()}] ${message}\n`); } catch {} };
const preferencePath = () => path.join(dataDir(), "desktop-preferences.json");
type ManagerHost = "127.0.0.1" | "0.0.0.0";
type DesktopPreferences = { closeToTray: boolean; launchAtLogin: boolean; launchOptions: LaunchAtLoginOptions; managerPort: number; managerHost: ManagerHost };
function normalizeManagerHost(value: unknown): ManagerHost { return value === "0.0.0.0" ? value : "127.0.0.1"; }
function preferences(): DesktopPreferences { try { const saved = JSON.parse(readFileSync(preferencePath(), "utf8")); return { closeToTray: saved.closeToTray !== false, launchAtLogin: saved.launchAtLogin === true, launchOptions: normalizeLaunchAtLoginOptions(saved.launchOptions), managerPort: normalizeManagerPort(saved.managerPort), managerHost: normalizeManagerHost(saved.managerHost) }; } catch { return { closeToTray: true, launchAtLogin: false, launchOptions: defaultLaunchAtLoginOptions, managerPort: defaultManagerPort, managerHost: "127.0.0.1" }; } }
function writePreferences(patch: Partial<DesktopPreferences>) { mkdirSync(dataDir(), { recursive: true }); writeFileSync(preferencePath(), JSON.stringify({ ...preferences(), ...patch }, null, 2)); }
const port = process.env.PSM_PORT ? validateManagerPort(process.env.PSM_PORT) : preferences().managerPort;
function remoteAccessEnabled(): boolean { try { return JSON.parse(readFileSync(path.join(dataDir(), "remote-access.json"), "utf8")).enabled === true; } catch { return false; } }
const host: ManagerHost = process.env.PSM_HOST === "0.0.0.0" ? "0.0.0.0" : remoteAccessEnabled() ? preferences().managerHost : "127.0.0.1";
function linuxAutostartPath() { return path.join(app.getPath("home"), ".config", "autostart", "com.palworld.servermanager.next.desktop"); }
function persistentDataArguments() { return process.argv.slice(1).filter((argument) => argument.startsWith("--user-data-dir=")); }
function desktopQuote(value: string) { return `"${value.replace(/([\\`"$])/g, "\\$1")}"`; }
function setLaunchAtLogin(enabled: boolean): boolean {
  if (isDev) throw new Error("Launch at login is only available in the packaged application.");
  const launchArguments = launchAtLoginArguments(preferences().launchOptions, persistentDataArguments());
  if (process.platform === "linux") {
    const filePath = linuxAutostartPath(); mkdirSync(path.dirname(filePath), { recursive: true });
    if (enabled) {
      const executable = process.env.APPIMAGE || process.execPath;
      const command = [executable, ...launchArguments].map(desktopQuote).join(" ");
      writeFileSync(filePath, `[Desktop Entry]\nType=Application\nName=Palworld Server Manager Next\nComment=Start the Palworld server supervisor at login\nExec=${command}\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`, { mode: 0o600 });
    } else rmSync(filePath, { force: true });
  } else app.setLoginItemSettings({ openAtLogin: enabled, args: enabled ? launchArguments : [] });
  writePreferences({ launchAtLogin: enabled }); return enabled;
}

function startServer() {
  if (isDev) { log(`Using development renderer: ${process.env.ELECTRON_START_URL}`); return; }
  serverFailure = null;
  const root = path.join(process.resourcesPath, "app"); const entry = path.join(root, "server.js");
  log(`Starting bundled web server from ${entry}`);
  if (!existsSync(entry)) throw new Error(`Bundled Next server is missing: ${entry}`);
  const serverModules = path.join(root, "server-node_modules");
  const nodePath = [serverModules, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
  server = spawn(process.execPath, [entry], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", NODE_ENV: "production", NODE_PATH: nodePath, HOSTNAME: host, PORT: String(port), PSM_ADMIN_TOKEN: token, PALWORLD_MANAGER_DATA_DIR: dataDir() } });
  log(`Bundled web server process created (pid ${server.pid ?? "unknown"})`);
  server.stdout?.on("data", (data) => log(`[web] ${String(data).trim()}`)); server.stderr?.on("data", (data) => log(`[web:error] ${String(data).trim()}`));
  server.on("error", (error) => { serverFailure = error.message; log(`Web server error: ${error.message}`); }); server.on("exit", (code) => { if (!quitting) serverFailure = `The bundled web server exited during startup (${code ?? "unknown status"}). The manager port ${port} may already be in use.`; log(`Web server exited: ${code}`); });
}

function ping(): Promise<boolean> { return new Promise((resolve) => { const req = request({ hostname: "127.0.0.1", port, path: "/", method: "HEAD", timeout: 1_000 }, (response) => { response.destroy(); resolve(true); }); req.on("error", () => resolve(false)); req.on("timeout", () => { req.destroy(); resolve(false); }); req.end(); }); }
async function waitForServer() { const deadline = Date.now() + 60_000; while (Date.now() < deadline) { if (serverFailure) throw new Error(serverFailure); if (await ping()) return; await new Promise((resolve) => setTimeout(resolve, 350)); } throw new Error(`The bundled web server did not answer on port ${port} within 60 seconds.`); }
function iconPath() { return isDev ? path.join(__dirname, "..", "public", "icon.png") : path.join(process.resourcesPath, "app", "public", "icon.png"); }

async function createWindow(show = true) {
  if (window) { if (show) { window.show(); window.focus(); } return; }
  const created = new BrowserWindow({ width: 1360, height: 860, minWidth: 960, minHeight: 640, show: false, backgroundColor: "#0b0d12", autoHideMenuBar: true, title: "Palworld Server Manager", icon: iconPath(), webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  window = created;
  Menu.setApplicationMenu(null); created.setMenuBarVisibility(false);
  created.webContents.on("did-fail-load", (_event, code, description, url, mainFrame) => { if (mainFrame) log(`Renderer failed ${url}: ${code} ${description}`); });
  created.webContents.on("render-process-gone", (_event, details) => log(`Renderer gone: ${details.reason} (${details.exitCode})`));
  created.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: "deny" }; });
  created.on("close", (event) => { if (!quitting && tray && preferences().closeToTray) { event.preventDefault(); created.hide(); } });
  created.on("closed", () => { if (window === created) window = null; });
  if (show) created.once("ready-to-show", () => { if (!created.isDestroyed()) { created.show(); created.focus(); } });
  const url = process.env.ELECTRON_START_URL || `http://127.0.0.1:${port}`;
  await created.webContents.session.cookies.set({ url: `http://127.0.0.1:${port}`, name: "psm_admin", value: token, httpOnly: true, sameSite: "lax" });
  try {
    await created.loadURL(url);
  } catch (error) {
    if (!isSupersededNavigation(error) || created.isDestroyed()) throw error;
    log(`Initial renderer navigation was superseded; continuing with ${created.webContents.getURL() || "the replacement route"}`);
  }
}

function createTray() { try { tray = new Tray(nativeImage.createFromPath(iconPath())); tray.setToolTip("Palworld Server Manager"); tray.setContextMenu(Menu.buildFromTemplate([{ label: "Open", click: () => void createWindow() }, { type: "separator" }, { label: "Quit", click: () => { quitting = true; app.quit(); } }])); tray.on("click", () => void createWindow()); } catch (error) { log(`Tray unavailable: ${String(error)}`); } }
function showStartupError(error: unknown) { const message = error instanceof Error ? error.message : String(error); log(message); window = new BrowserWindow({ width: 720, height: 420, backgroundColor: "#0b0d12", title: "Palworld Server Manager" }); void window.loadURL(`data:text/html,${encodeURIComponent(`<body style="background:#0b0d12;color:#edf1f7;font:16px system-ui;padding:40px"><h2>Manager startup failed</h2><p>${message}</p><p>See ${path.join(dataDir(), "launcher-v3.log")}</p></body>`)}`); }

ipcMain.handle("pick-directory", async () => { const result = await dialog.showOpenDialog(window!, { properties: ["openDirectory", "createDirectory"] }); return result.canceled ? null : result.filePaths[0]; });
ipcMain.handle("pick-zip", async () => { const result = await dialog.showOpenDialog(window!, { properties: ["openFile"], filters: [{ name: "Zip archives", extensions: ["zip"] }] }); return result.canceled ? null : result.filePaths[0]; });
ipcMain.handle("pick-registration", async () => { const result = await dialog.showOpenDialog(window!, { properties: ["openFile"], filters: [{ name: "PSM Next registration", extensions: ["json"] }] }); const filePath = result.filePaths[0]; if (result.canceled || !filePath) return null; if (statSync(filePath).size > 1_048_576) throw new Error("Registration files must be smaller than 1 MiB."); return { fileName: path.basename(filePath), content: readFileSync(filePath, "utf8") }; });
ipcMain.handle("save-registration", async (_event, defaultName: string, content: string) => { if (Buffer.byteLength(content, "utf8") > 1_048_576) throw new Error("Registration files must be smaller than 1 MiB."); const safeName = path.basename(defaultName).replace(/[^a-zA-Z0-9._-]/g, "-"); const result = await dialog.showSaveDialog(window!, { defaultPath: safeName, filters: [{ name: "PSM Next registration", extensions: ["json"] }] }); if (result.canceled || !result.filePath) return null; writeFileSync(result.filePath, content, { mode: 0o600 }); return result.filePath; });
ipcMain.handle("open-path", (_event, target: string) => shell.openPath(target)); ipcMain.handle("get-theme", () => nativeTheme.shouldUseDarkColors ? "dark" : "light"); ipcMain.handle("get-locale", () => app.getLocale() || "en");
ipcMain.handle("get-close-to-tray", () => preferences().closeToTray); ipcMain.handle("set-close-to-tray", (_event, enabled: boolean) => { writePreferences({ closeToTray: Boolean(enabled) }); return Boolean(enabled); });
ipcMain.handle("get-launch-at-login", () => preferences().launchAtLogin); ipcMain.handle("set-launch-at-login", (_event, enabled: boolean) => setLaunchAtLogin(Boolean(enabled)));
ipcMain.handle("get-launch-at-login-options", () => preferences().launchOptions);
ipcMain.handle("set-launch-at-login-options", (_event, value: unknown) => {
  const launchOptions = normalizeLaunchAtLoginOptions(value); parseCustomLaunchFlags(launchOptions.customFlags); writePreferences({ launchOptions });
  if (preferences().launchAtLogin) setLaunchAtLogin(true);
  return launchOptions;
});
ipcMain.handle("get-manager-port", () => ({ configured: preferences().managerPort, active: port }));
ipcMain.handle("set-manager-port", (_event, value: unknown) => { const managerPort = validateManagerPort(value); writePreferences({ managerPort }); return { configured: managerPort, active: port, restartRequired: managerPort !== port }; });
ipcMain.handle("get-manager-network", () => ({ configuredHost: preferences().managerHost, activeHost: host, port, addresses: Object.values(networkInterfaces()).flat().filter((entry) => entry?.family === "IPv4" && !entry.internal).map((entry) => entry!.address) }));
ipcMain.handle("set-manager-host", (_event, value: unknown) => { const managerHost = normalizeManagerHost(value); if (managerHost === "0.0.0.0" && !remoteAccessEnabled()) throw new Error("Enable authenticated remote access before allowing LAN connections."); writePreferences({ managerHost }); return { configuredHost: managerHost, activeHost: host, restartRequired: managerHost !== host }; });

const ownsInstanceLock = app.requestSingleInstanceLock();
if (!ownsInstanceLock) app.quit(); else {
  app.on("second-instance", () => void createWindow());
  app.whenReady().then(async () => { try { mkdirSync(dataDir(), { recursive: true }); log(`Desktop ready (data ${dataDir()}, bind ${host}:${port}, AppImage ${Boolean(process.env.APPIMAGE)}, hidden ${startHidden})`); powerSaveBlocker.start("prevent-app-suspension"); startServer(); await waitForServer(); log("Bundled web server is ready"); createTray(); await createWindow(!startHidden); log(startHidden ? "Main window loaded hidden" : "Main window loaded"); } catch (error) { showStartupError(error); } });
  app.on("before-quit", () => { quitting = true; tray?.destroy(); server?.kill(); });
  app.on("window-all-closed", () => { if (!preferences().closeToTray || !tray) app.quit(); });
}
