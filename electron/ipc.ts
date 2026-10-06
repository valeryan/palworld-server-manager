import { app, dialog, ipcMain, nativeTheme, shell } from "electron";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { loginStatus, setLaunchAtLogin } from "./autostart";
import { host, port } from "./binding";
import { normalizeLaunchAtLoginOptions, parseCustomLaunchFlags, validateManagerPort } from "./launch-options";
import { normalizeManagerHost, preferences, remoteAccessEnabled, writePreferences } from "./preferences";
import { mainWindow } from "./window";

// Everything the renderer may ask the desktop shell to do; see preload.ts for the exposed surface.
export function registerIpcHandlers(): void {
  ipcMain.handle("pick-directory", async () => { const result = await dialog.showOpenDialog(mainWindow()!, { properties: ["openDirectory", "createDirectory"] }); return result.canceled ? null : result.filePaths[0]; });
  ipcMain.handle("pick-zip", async () => { const result = await dialog.showOpenDialog(mainWindow()!, { properties: ["openFile"], filters: [{ name: "Zip archives", extensions: ["zip"] }] }); return result.canceled ? null : result.filePaths[0]; });
  ipcMain.handle("pick-registration", async () => { const result = await dialog.showOpenDialog(mainWindow()!, { properties: ["openFile"], filters: [{ name: "PSM Next registration", extensions: ["json"] }] }); const filePath = result.filePaths[0]; if (result.canceled || !filePath) return null; if (statSync(filePath).size > 1_048_576) throw new Error("Registration files must be smaller than 1 MiB."); return { fileName: path.basename(filePath), content: readFileSync(filePath, "utf8") }; });
  ipcMain.handle("save-registration", async (_event, defaultName: string, content: string) => { if (Buffer.byteLength(content, "utf8") > 1_048_576) throw new Error("Registration files must be smaller than 1 MiB."); const safeName = path.basename(defaultName).replace(/[^a-zA-Z0-9._-]/g, "-"); const result = await dialog.showSaveDialog(mainWindow()!, { defaultPath: safeName, filters: [{ name: "PSM Next registration", extensions: ["json"] }] }); if (result.canceled || !result.filePath) return null; writeFileSync(result.filePath, content, { mode: 0o600 }); return result.filePath; });
  ipcMain.handle("open-path", (_event, target: unknown) => {
    // The renderer may only open an existing directory, never launch a file.
    if (typeof target !== "string" || !path.isAbsolute(target) || !statSync(target, { throwIfNoEntry: false })?.isDirectory()) throw new Error("Only an existing directory can be opened.");
    return shell.openPath(target);
  });
  ipcMain.handle("get-theme", () => nativeTheme.shouldUseDarkColors ? "dark" : "light"); ipcMain.handle("get-locale", () => app.getLocale() || "en");
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
}
