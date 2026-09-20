import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, powerSaveBlocker, shell, Tray } from "electron";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

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

const isDev = Boolean(process.env.ELECTRON_START_URL); const port = Number(process.env.PSM_PORT || 4318); const token = randomBytes(32).toString("hex");
let window: BrowserWindow | null = null; let tray: Tray | null = null; let server: ChildProcess | null = null; let quitting = false;
if (process.env.PORTABLE_EXECUTABLE_DIR) { const portable = path.join(process.env.PORTABLE_EXECUTABLE_DIR, "PSM-Data"); mkdirSync(portable, { recursive: true }); app.setPath("userData", portable); }
const dataDir = () => app.getPath("userData"); const log = (message: string) => { try { appendFileSync(path.join(dataDir(), "launcher-v3.log"), `[${new Date().toISOString()}] ${message}\n`); } catch {} };
const preferencePath = () => path.join(dataDir(), "desktop-preferences.json");
function preferences(): { closeToTray: boolean } { try { return { closeToTray: JSON.parse(readFileSync(preferencePath(), "utf8")).closeToTray !== false }; } catch { return { closeToTray: true }; } }
function writePreferences(next: { closeToTray: boolean }) { mkdirSync(dataDir(), { recursive: true }); writeFileSync(preferencePath(), JSON.stringify(next, null, 2)); }

function startServer() {
  if (isDev) { log(`Using development renderer: ${process.env.ELECTRON_START_URL}`); return; }
  const root = path.join(process.resourcesPath, "app"); const entry = path.join(root, "server.js");
  log(`Starting bundled web server from ${entry}`);
  if (!existsSync(entry)) throw new Error(`Bundled Next server is missing: ${entry}`);
  const serverModules = path.join(root, "server-node_modules");
  const nodePath = [serverModules, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
  server = spawn(process.execPath, [entry], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", NODE_ENV: "production", NODE_PATH: nodePath, HOSTNAME: "127.0.0.1", PORT: String(port), PSM_ADMIN_TOKEN: token, PALWORLD_MANAGER_DATA_DIR: dataDir() } });
  log(`Bundled web server process created (pid ${server.pid ?? "unknown"})`);
  server.stdout?.on("data", (data) => log(`[web] ${String(data).trim()}`)); server.stderr?.on("data", (data) => log(`[web:error] ${String(data).trim()}`));
  server.on("error", (error) => log(`Web server error: ${error.message}`)); server.on("exit", (code) => log(`Web server exited: ${code}`));
}

function ping(): Promise<boolean> { return new Promise((resolve) => { const req = request({ hostname: "127.0.0.1", port, path: "/", method: "HEAD", timeout: 1_000 }, (response) => { response.destroy(); resolve(true); }); req.on("error", () => resolve(false)); req.on("timeout", () => { req.destroy(); resolve(false); }); req.end(); }); }
async function waitForServer() { const deadline = Date.now() + 60_000; while (Date.now() < deadline) { if (await ping()) return; await new Promise((resolve) => setTimeout(resolve, 350)); } throw new Error("The bundled web server did not answer within 60 seconds."); }
function iconPath() { return isDev ? path.join(__dirname, "..", "public", "icon.png") : path.join(process.resourcesPath, "app", "public", "icon.png"); }

async function createWindow() {
  if (window) { window.show(); window.focus(); return; }
  window = new BrowserWindow({ width: 1360, height: 860, minWidth: 960, minHeight: 640, show: false, backgroundColor: "#0b0d12", autoHideMenuBar: true, title: "Palworld Server Manager", icon: iconPath(), webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  Menu.setApplicationMenu(null); window.setMenuBarVisibility(false);
  window.webContents.on("did-fail-load", (_event, code, description, url, mainFrame) => { if (mainFrame) log(`Renderer failed ${url}: ${code} ${description}`); });
  window.webContents.on("render-process-gone", (_event, details) => log(`Renderer gone: ${details.reason} (${details.exitCode})`));
  window.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: "deny" }; });
  window.on("close", (event) => { if (!quitting && tray && preferences().closeToTray) { event.preventDefault(); window?.hide(); } }); window.on("closed", () => { window = null; });
  const url = process.env.ELECTRON_START_URL || `http://127.0.0.1:${port}`;
  await window.webContents.session.cookies.set({ url: `http://127.0.0.1:${port}`, name: "psm_admin", value: token, httpOnly: true, sameSite: "lax" });
  await window.loadURL(url); window.once("ready-to-show", () => window?.show());
}

function createTray() { try { tray = new Tray(nativeImage.createFromPath(iconPath())); tray.setToolTip("Palworld Server Manager"); tray.setContextMenu(Menu.buildFromTemplate([{ label: "Open", click: () => void createWindow() }, { type: "separator" }, { label: "Quit", click: () => { quitting = true; app.quit(); } }])); tray.on("click", () => void createWindow()); } catch (error) { log(`Tray unavailable: ${String(error)}`); } }
function showStartupError(error: unknown) { const message = error instanceof Error ? error.message : String(error); log(message); window = new BrowserWindow({ width: 720, height: 420, backgroundColor: "#0b0d12", title: "Palworld Server Manager" }); void window.loadURL(`data:text/html,${encodeURIComponent(`<body style="background:#0b0d12;color:#edf1f7;font:16px system-ui;padding:40px"><h2>Manager startup failed</h2><p>${message}</p><p>See ${path.join(dataDir(), "launcher-v3.log")}</p></body>`)}`); }

ipcMain.handle("pick-directory", async () => { const result = await dialog.showOpenDialog(window!, { properties: ["openDirectory", "createDirectory"] }); return result.canceled ? null : result.filePaths[0]; });
ipcMain.handle("pick-zip", async () => { const result = await dialog.showOpenDialog(window!, { properties: ["openFile"], filters: [{ name: "Zip archives", extensions: ["zip"] }] }); return result.canceled ? null : result.filePaths[0]; });
ipcMain.handle("open-path", (_event, target: string) => shell.openPath(target)); ipcMain.handle("get-theme", () => nativeTheme.shouldUseDarkColors ? "dark" : "light"); ipcMain.handle("get-locale", () => app.getLocale() || "en");
ipcMain.handle("get-close-to-tray", () => preferences().closeToTray); ipcMain.handle("set-close-to-tray", (_event, enabled: boolean) => { writePreferences({ closeToTray: Boolean(enabled) }); return Boolean(enabled); });

const ownsInstanceLock = app.requestSingleInstanceLock();
if (!ownsInstanceLock) app.quit(); else {
  app.on("second-instance", () => void createWindow());
  app.whenReady().then(async () => { try { mkdirSync(dataDir(), { recursive: true }); log(`Desktop ready (data ${dataDir()}, port ${port}, AppImage ${Boolean(process.env.APPIMAGE)})`); powerSaveBlocker.start("prevent-app-suspension"); startServer(); await waitForServer(); log("Bundled web server is ready"); createTray(); await createWindow(); log("Main window loaded"); } catch (error) { showStartupError(error); } });
  app.on("before-quit", () => { quitting = true; tray?.destroy(); server?.kill(); });
  app.on("window-all-closed", () => { if (!preferences().closeToTray || !tray) app.quit(); });
}
