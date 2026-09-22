import "server-only";
import { readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { defaultRetentionSettings, retentionSettingsSchema, type RetentionSettings } from "@/contracts/retention";
import { database, sqliteClient } from "@/server/db";
import { appSettings, worlds } from "@/server/db/schema";
import { paths } from "@/server/paths";

const DAY = 86_400_000;
const SETTING_KEY = "retention-v1";
type CleanupReport = { operations: number; operationLogs: number; events: number; sessions: number; deaths: number; serverLogs: number; configurationVersions: number };

function changes(result: { changes: number | bigint }): number { return Number(result.changes); }

export async function getRetentionSettings(): Promise<RetentionSettings> {
  const [record] = await database().select().from(appSettings).where(eq(appSettings.key, SETTING_KEY)).limit(1);
  const parsed = retentionSettingsSchema.safeParse(record?.value);
  return parsed.success ? parsed.data : defaultRetentionSettings;
}

export async function saveRetentionSettings(value: unknown): Promise<{ settings: RetentionSettings; report: CleanupReport }> {
  const settings = retentionSettingsSchema.parse(value);
  await database().insert(appSettings).values({ key: SETTING_KEY, value: settings }).onConflictDoUpdate({ target: appSettings.key, set: { value: settings } });
  return { settings, report: await applyRetentionPolicy(settings) };
}

export async function applyOperationRetention(providedSettings?: RetentionSettings, now = Date.now()): Promise<Pick<CleanupReport, "operations" | "operationLogs">> {
  const settings = providedSettings ?? await getRetentionSettings();
  const client = sqliteClient();
  const operationLogs = changes(client.prepare(`DELETE FROM job_logs WHERE id IN (
    SELECT id FROM (SELECT id, row_number() OVER (PARTITION BY job_id ORDER BY id DESC) AS position FROM job_logs) WHERE position > ?
  )`).run(settings.operationLogLines));
  const operations = changes(client.prepare(`DELETE FROM jobs WHERE state NOT IN ('queued','running') AND (
    COALESCE(finished_at,created_at) < ? OR id NOT IN (
      SELECT id FROM jobs WHERE state NOT IN ('queued','running') ORDER BY COALESCE(finished_at,created_at) DESC LIMIT ?
    )
  )`).run(now - settings.operationDays * DAY, settings.operationCount));
  return { operations, operationLogs };
}

export async function pruneConfigurationVersions(worldId: string, providedSettings?: RetentionSettings): Promise<number> {
  const settings = providedSettings ?? await getRetentionSettings();
  return changes(sqliteClient().prepare(`DELETE FROM config_versions WHERE world_id=? AND id NOT IN (
    SELECT id FROM config_versions WHERE world_id=? ORDER BY created_at DESC LIMIT ?
  )`).run(worldId, worldId, settings.configurationVersionsPerWorld));
}

async function pruneServerLogs(keep: number): Promise<number> {
  let removed = 0;
  const registered = await database().select({ id: worlds.id }).from(worlds);
  for (const world of registered) {
    const directory = paths.worldLogs(world.id);
    const files = (await readdir(directory).catch(() => [] as string[])).filter((name) => /^server-.*\.log$/.test(name)).sort().reverse();
    for (const name of files.slice(keep)) {
      await unlink(path.join(directory, name)).then(() => { removed += 1; }).catch(() => undefined);
    }
  }
  return removed;
}

export async function applyRetentionPolicy(providedSettings?: RetentionSettings, now = Date.now()): Promise<CleanupReport> {
  const settings = providedSettings ?? await getRetentionSettings();
  const client = sqliteClient(); const operation = await applyOperationRetention(settings, now); const activityCutoff = now - settings.activityDays * DAY;
  const pruneActivity = (table: "events" | "sessions" | "deaths") => changes(client.prepare(`DELETE FROM ${table} WHERE created_at < ? OR id IN (
    SELECT id FROM (SELECT id, row_number() OVER (PARTITION BY world_id ORDER BY created_at DESC) AS position FROM ${table}) WHERE position > ?
  )`).run(activityCutoff, settings.activityCountPerWorld));
  const events = pruneActivity("events"); const sessions = pruneActivity("sessions"); const deaths = pruneActivity("deaths");
  const configurationVersions = changes(client.prepare(`DELETE FROM config_versions WHERE id IN (
    SELECT id FROM (SELECT id, row_number() OVER (PARTITION BY world_id ORDER BY created_at DESC) AS position FROM config_versions) WHERE position > ?
  )`).run(settings.configurationVersionsPerWorld));
  return { ...operation, events, sessions, deaths, configurationVersions, serverLogs: await pruneServerLogs(settings.serverLogFilesPerWorld) };
}
