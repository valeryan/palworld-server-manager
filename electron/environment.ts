import { app } from "electron";
import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

// Process-wide facts about this launch: development or packaged, where the data profile lives,
// the secrets shared with the bundled server, and the quit flags every module consults.

export const isDev = Boolean(process.env.ELECTRON_START_URL);
export const developmentUrl = isDev ? new URL(process.env.ELECTRON_START_URL!) : null;
export const token = randomBytes(32).toString("hex");
export const launchSession = randomBytes(24).toString("hex");

/** Why the data profile could not be prepared; reported once the application is ready. */
let profileError: unknown;
if (isDev && process.env.PALWORLD_MANAGER_DATA_DIR) { const developmentProfile = path.resolve(process.env.PALWORLD_MANAGER_DATA_DIR, "electron"); mkdirSync(developmentProfile, { recursive: true }); app.setPath("userData", developmentProfile); }
else if (process.env.PORTABLE_EXECUTABLE_DIR) { const portable = path.join(process.env.PORTABLE_EXECUTABLE_DIR, "PSM-Data"); try { mkdirSync(portable, { recursive: true }); app.setPath("userData", portable); } catch (error) { profileError = error; } }
export function profileSetupError(): unknown { return profileError; }

export const dataDir = () => app.getPath("userData");
export const launcherLogPath = () => path.join(dataDir(), "launcher-v3.log");
export const log = (message: string) => { try { appendFileSync(launcherLogPath(), `[${new Date().toISOString()}] ${message}\n`); } catch {} };
export function linuxAutostartPath() { return path.join(app.getPath("home"), ".config", "autostart", "com.palworld.servermanager.next.desktop"); }

/** Shutdown progress shared between the window, tray, server process and quit handlers. */
export const quitState = { quitting: false, quitDrained: false, drainingQuit: false };
