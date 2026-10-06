import { app, BrowserWindow, Menu, nativeImage, shell, Tray } from "electron";
import path from "node:path";
import { port } from "./binding";
import { desktopIconPath } from "./desktop-icon";
import { developmentUrl, isDev, log, quitState, token } from "./environment";
import { isSupersededNavigation } from "./navigation";
import { preferences } from "./preferences";
import { runtimeRequest, stopServer } from "./server-process";

// The main renderer window and the tray icon that keeps the manager alive when it is closed.

let window: BrowserWindow | null = null; let tray: Tray | null = null;
export function mainWindow(): BrowserWindow | null { return window; }
export function trayAvailable(): boolean { return tray !== null; }
export function destroyTray(): void { tray?.destroy(); tray = null; }

export function iconPath() { return desktopIconPath({ isDevelopment: isDev, platform: process.platform, developmentRoot: path.join(__dirname, ".."), resourcesPath: process.resourcesPath }); }

export async function createWindow(show = true) {
  if (window) { if (show) { window.show(); window.focus(); } return; }
  const created = new BrowserWindow({ width: 1360, height: 860, minWidth: 960, minHeight: 640, show: false, backgroundColor: "#0b0d12", autoHideMenuBar: true, title: "Palworld Server Manager", icon: iconPath(), webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  window = created;
  Menu.setApplicationMenu(null); created.setMenuBarVisibility(false);
  created.webContents.on("did-fail-load", (_event, code, description, url, mainFrame) => { if (mainFrame) log(`Renderer failed ${url}: ${code} ${description}`); });
  created.webContents.on("render-process-gone", (_event, details) => log(`Renderer gone: ${details.reason} (${details.exitCode})`));
  created.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: "deny" }; });
  created.on("close", (event) => { if (!quitState.quitting && tray && preferences().closeToTray) { event.preventDefault(); created.hide(); } });
  created.on("query-session-end", () => { quitState.quitting = true; void runtimeRequest("drain", "POST").catch((error) => log(`Session-end drain: ${String(error)}`)); });
  created.on("session-end", () => { quitState.quitDrained = true; void stopServer(); });
  created.on("closed", () => { if (window === created) window = null; });
  if (show) created.once("ready-to-show", () => { if (!created.isDestroyed()) { created.show(); created.focus(); } });
  const url = developmentUrl?.toString() || `http://127.0.0.1:${port()}`;
  await created.webContents.session.cookies.set({ url: developmentUrl?.origin || `http://127.0.0.1:${port()}`, name: "psm_admin", value: token, httpOnly: true, sameSite: "lax" });
  try {
    await created.loadURL(url);
  } catch (error) {
    if (!isSupersededNavigation(error) || created.isDestroyed()) throw error;
    log(`Initial renderer navigation was superseded; continuing with ${created.webContents.getURL() || "the replacement route"}`);
  }
}

export function createTray() { try { tray = new Tray(nativeImage.createFromPath(iconPath())); tray.setToolTip("Palworld Server Manager"); tray.setContextMenu(Menu.buildFromTemplate([{ label: "Open", click: () => void createWindow() }, { type: "separator" }, { label: "Quit", click: () => { quitState.quitting = true; app.quit(); } }])); tray.on("click", () => void createWindow()); } catch (error) { log(`Tray unavailable: ${String(error)}`); } }
