import { contextBridge, ipcRenderer } from "electron";
import type { LaunchAtLoginOptions } from "./launch-options";

const desktop = {
  pickDirectory: (): Promise<string | null> => ipcRenderer.invoke("pick-directory"),
  pickZip: (): Promise<string | null> => ipcRenderer.invoke("pick-zip"),
  pickRegistration: (): Promise<{ fileName: string; content: string } | null> => ipcRenderer.invoke("pick-registration"),
  saveRegistration: (defaultName: string, content: string): Promise<string | null> => ipcRenderer.invoke("save-registration", defaultName, content),
  openPath: (target: string): Promise<string> => ipcRenderer.invoke("open-path", target),
  getTheme: (): Promise<"dark" | "light"> => ipcRenderer.invoke("get-theme"),
  getLocale: (): Promise<string> => ipcRenderer.invoke("get-locale"),
  getCloseToTray: (): Promise<boolean> => ipcRenderer.invoke("get-close-to-tray"),
  setCloseToTray: (enabled: boolean): Promise<boolean> => ipcRenderer.invoke("set-close-to-tray", enabled),
  getStartMinimized: (): Promise<boolean> => ipcRenderer.invoke("get-start-minimized"),
  setStartMinimized: (enabled: boolean): Promise<boolean> => ipcRenderer.invoke("set-start-minimized", enabled),
  getLoginStatus: (): Promise<{ configured: boolean; enabled: boolean; disabledByOS: boolean; unavailable: boolean }> => ipcRenderer.invoke("get-login-status"),
  getLaunchAtLogin: (): Promise<boolean> => ipcRenderer.invoke("get-launch-at-login"),
  setLaunchAtLogin: (enabled: boolean): Promise<boolean> => ipcRenderer.invoke("set-launch-at-login", enabled),
  getLaunchAtLoginOptions: (): Promise<LaunchAtLoginOptions> => ipcRenderer.invoke("get-launch-at-login-options"),
  setLaunchAtLoginOptions: (options: LaunchAtLoginOptions): Promise<LaunchAtLoginOptions> => ipcRenderer.invoke("set-launch-at-login-options", options),
};
contextBridge.exposeInMainWorld("psmDesktop", desktop);
export type DesktopApi = typeof desktop;
