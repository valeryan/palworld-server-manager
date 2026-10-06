import { app } from "electron";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { isDev, linuxAutostartPath } from "./environment";
import { launchAtLoginArguments } from "./launch-options";
import { atomicWrite, preferences, writePreferences } from "./preferences";

// Launch at login: a managed .desktop entry on Linux, the OS login item elsewhere.

function persistentDataArguments() { return process.argv.slice(1).filter((argument) => argument.startsWith("--user-data-dir=")); }
function desktopQuote(value: string) { return `"${value.replace(/([\\`"$])/g, "\\$1")}"`; }
function autostartContents(): string { const executable = process.env.APPIMAGE || process.execPath; const launchArguments = launchAtLoginArguments({ ...preferences().launchOptions, forceX11: process.platform === "linux" && preferences().launchOptions.forceX11 }, persistentDataArguments()); const command = [executable, ...launchArguments].map(desktopQuote).join(" "); return `[Desktop Entry]\nType=Application\nName=Palworld Server Manager Next\nComment=Start the Palworld server supervisor at login\nExec=${command}\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`; }

/** The existing entry with only its executable replaced, so a moved AppImage keeps its flags. */
export function updatedAutostartContents(content: string): string {
  const executable = process.env.APPIMAGE || process.execPath;
  const command = /^Exec=(?:"(?:\\.|[^"\\])*"|\S+)(.*)$/m.exec(content);
  if (!command) throw new Error("The managed launch-at-login entry has no replaceable Exec command.");
  return content.replace(command[0], () => `Exec=${desktopQuote(executable)}${command[1]}`);
}
export function restoreAutostart(filePath: string, content: string | null): void { if (content === null) rmSync(filePath, { force: true }); else atomicWrite(filePath, content); }

function loginExecutable(): string { return process.env.PORTABLE_EXECUTABLE_FILE || (process.env.PORTABLE_EXECUTABLE_DIR && process.env.PORTABLE_EXECUTABLE_APP_FILENAME ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, process.env.PORTABLE_EXECUTABLE_APP_FILENAME) : process.execPath); }

export function loginStatus() {
  if (process.platform !== "win32") return { configured: preferences().launchAtLogin, enabled: preferences().launchAtLogin, disabledByOS: false };
  const state = app.getLoginItemSettings({ path: loginExecutable(), args: launchAtLoginArguments({ ...preferences().launchOptions, forceX11: false }, persistentDataArguments()) });
  return { configured: state.openAtLogin, enabled: state.openAtLogin && state.executableWillLaunchAtLogin, disabledByOS: state.openAtLogin && !state.executableWillLaunchAtLogin };
}

export function setLaunchAtLogin(enabled: boolean, preserveApproval = false): boolean {
  if (isDev) throw new Error("Launch at login is only available in the packaged application.");
  const launchArguments = launchAtLoginArguments({ ...preferences().launchOptions, forceX11: process.platform === "linux" && preferences().launchOptions.forceX11 }, persistentDataArguments());
  if (process.platform === "linux") {
    const filePath = linuxAutostartPath(); mkdirSync(path.dirname(filePath), { recursive: true });
    if (enabled) atomicWrite(filePath, autostartContents()); else rmSync(filePath, { force: true });
  } else {
    const approved = enabled && (!preserveApproval || app.getLoginItemSettings({ path: preferences().lastLoginExecutable ?? loginExecutable() }).executableWillLaunchAtLogin);
    app.setLoginItemSettings({ openAtLogin: enabled, enabled: approved, path: loginExecutable(), args: launchArguments });
  }
  writePreferences({ launchAtLogin: enabled, lastLoginExecutable: loginExecutable() }); return enabled;
}
