import { contextBridge, ipcRenderer } from "electron";

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
  getLaunchAtLogin: (): Promise<boolean> => ipcRenderer.invoke("get-launch-at-login"),
  setLaunchAtLogin: (enabled: boolean): Promise<boolean> => ipcRenderer.invoke("set-launch-at-login", enabled),
};
contextBridge.exposeInMainWorld("psmDesktop", desktop);
export type DesktopApi = typeof desktop;
