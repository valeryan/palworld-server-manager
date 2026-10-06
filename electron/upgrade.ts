import { app } from "electron";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { compareSemanticVersions } from "../src/lib/semver";
import { runDatabasePreflight, type PreflightOptions } from "../src/server/db/upgrade";
import { restoreAutostart, updatedAutostartContents } from "./autostart";
import { dataDir, linuxAutostartPath, log, quitState } from "./environment";
import { atomicWrite, preferences } from "./preferences";
import { confirmVersionTransition, showUpgradeProgress } from "./upgrade-ui";

export function preflightOptions(): PreflightOptions { return { databasePath: path.join(dataDir(), "registry-v3.sqlite"), dataDirectory: dataDir(), migrationsFolder: path.join(process.resourcesPath, "app", "drizzle") }; }

/** Confirms a version change with the user, then runs the database preflight and keeps the Linux autostart entry pointing at this executable. */
export async function activatePackagedVersion(): Promise<void> {
  const current = app.getVersion(); const saved = preferences().lastSuccessfulAppVersion; const databaseExists = existsSync(preflightOptions().databasePath);
  const comparison = saved ? compareSemanticVersions(current, saved) : databaseExists ? 1 : 0;
  const transition = databaseExists && (!saved || comparison !== 0);
  if (transition && !await confirmVersionTransition(saved, current, comparison !== null && comparison < 0)) { quitState.quitting = true; app.quit(); throw new Error("Application upgrade was cancelled."); }
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
