import { randomUUID } from "node:crypto";
import type { DatabaseSync as DatabaseConnection } from "node:sqlite";
import { chmod, copyFile, mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import { migrationDigest, releasedMigrations, verifyMigrationFiles } from "./migration-catalog";

const { backup, DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");

type AppliedMigration = { name: string; hash: string };
export type UpgradeStage = "preparing" | "backing-up" | "updating-autostart" | "migrating" | "verifying";
export type PreflightOptions = {
  databasePath: string;
  dataDirectory: string;
  migrationsFolder: string;
  onProgress?: (stage: UpgradeStage) => void | Promise<void>;
  beforeMigrate?: () => void | Promise<void>;
  injectFailure?: "backup" | "migration" | "post-check";
};
export type PreflightResult = {
  result: "fresh" | "current" | "upgraded";
  migrated: boolean;
  schemaHead: string | null;
  sourceSchemaHead: string | null;
  backupPath: string | null;
  migrationDigest: string;
};

const readyDatabases = new Set<string>();
const backupPath = (dataDirectory: string) => path.join(/* turbopackIgnore: true */ dataDirectory, "registry-v3.pre-upgrade.sqlite");

export class UpgradePreflightError extends Error {
  constructor(message: string, readonly databasePath: string, readonly backupPath: string | null, readonly causeDetail: string) { super(message); }
}

export function databaseWasPrepared(databasePath: string): boolean { return readyDatabases.has(path.resolve(/* turbopackIgnore: true */ databasePath)); }
export function markDatabasePrepared(databasePath: string): void { readyDatabases.add(path.resolve(/* turbopackIgnore: true */ databasePath)); }
export function forgetPreparedDatabase(databasePath?: string): void { if (databasePath) readyDatabases.delete(path.resolve(/* turbopackIgnore: true */ databasePath)); else readyDatabases.clear(); }

function configure(client: DatabaseConnection): void { client.exec("PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL;"); }
function tableExists(client: DatabaseConnection, table: string): boolean { return Boolean(client.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)); }
function applicationTables(client: DatabaseConnection): string[] { return (client.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>).map((row) => row.name); }
function integrity(client: DatabaseConnection): void {
  const rows = client.prepare("PRAGMA integrity_check").all() as Array<{ integrity_check: string }>;
  if (rows.length !== 1 || rows[0]?.integrity_check !== "ok") throw new Error(`SQLite integrity check failed: ${rows.map((row) => row.integrity_check).join(", ")}`);
  const foreign = client.prepare("PRAGMA foreign_key_check").all();
  if (foreign.length) throw new Error(`SQLite foreign-key check found ${foreign.length} violation(s).`);
}
function appliedMigrations(client: DatabaseConnection): AppliedMigration[] {
  if (!tableExists(client, "__drizzle_migrations")) return [];
  const columns = new Set((client.prepare("PRAGMA table_info('__drizzle_migrations')").all() as Array<{ name: string }>).map((row) => row.name));
  const rows = client.prepare(`SELECT hash${columns.has("name") ? ", name" : ""} FROM __drizzle_migrations ORDER BY id`).all() as Array<{ hash: string; name?: string | null }>;
  return rows.map((row, index) => ({ name: row.name ?? releasedMigrations.find((item) => item.hash === row.hash)?.name ?? `unknown-${index + 1}`, hash: row.hash }));
}
function validateApplied(applied: AppliedMigration[]): void {
  if (applied.length > releasedMigrations.length) throw new Error("This database was created by a newer application and cannot be opened safely.");
  applied.forEach((row, index) => {
    const expected = releasedMigrations[index];
    if (!expected || row.hash !== expected.hash || row.name !== expected.name) throw new Error(`Database migration ${row.name} is not an ordered prefix of this application's migrations.`);
  });
}
async function verifyDatabaseFile(filePath: string): Promise<void> {
  const client = new DatabaseSync(filePath, { readOnly: true });
  try { configure(client); integrity(client); }
  finally { client.close(); await rm(`${filePath}-wal`, { force: true }); await rm(`${filePath}-shm`, { force: true }); }
}
async function createBackup(client: DatabaseConnection, target: string): Promise<void> {
  const temporary = `${target}.tmp-${randomUUID()}`;
  try { await backup(client, temporary); await chmod(temporary, 0o600); await verifyDatabaseFile(temporary); await rename(temporary, target); await chmod(target, 0o600); }
  finally { await rm(temporary, { force: true }); }
}
async function replaceDatabase(source: string, target: string): Promise<void> {
  const temporary = `${target}.restore-${randomUUID()}`;
  await copyFile(source, temporary); await chmod(temporary, 0o600); await verifyDatabaseFile(temporary);
  await rm(`${target}-wal`, { force: true }); await rm(`${target}-shm`, { force: true }); await rename(temporary, target); await chmod(target, 0o600);
}

export async function runDatabasePreflight(options: PreflightOptions): Promise<PreflightResult> {
  const resolved = { ...options, databasePath: path.resolve(/* turbopackIgnore: true */ options.databasePath), dataDirectory: path.resolve(/* turbopackIgnore: true */ options.dataDirectory), migrationsFolder: path.resolve(/* turbopackIgnore: true */ options.migrationsFolder) };
  await resolved.onProgress?.("preparing");
  await mkdir(path.dirname(resolved.databasePath), { recursive: true, mode: 0o700 }); verifyMigrationFiles(resolved.migrationsFolder);
  const existed = (await stat(resolved.databasePath).catch(() => null))?.isFile() === true;
  const client = new DatabaseSync(resolved.databasePath, { timeout: 5_000 }); configure(client); await chmod(resolved.databasePath, 0o600);
  let snapshot: string | null = null; let sourceSchemaHead: string | null = null; let pending = false;
  try {
    integrity(client); const applied = appliedMigrations(client);
    if (!applied.length && existed && applicationTables(client).length) throw new Error("The existing database has application tables but no recognized migration history.");
    validateApplied(applied); sourceSchemaHead = applied.at(-1)?.name ?? null; pending = applied.length < releasedMigrations.length;
    if (pending && existed) {
      await resolved.onProgress?.("backing-up");
      if (options.injectFailure === "backup") throw new Error("Injected backup failure.");
      const completedSnapshot = backupPath(resolved.dataDirectory); await createBackup(client, completedSnapshot); snapshot = completedSnapshot;
    }
    await resolved.beforeMigrate?.();
    if (options.injectFailure === "migration") throw new Error("Injected migration failure.");
    await resolved.onProgress?.("migrating"); migrate(drizzle({ client }), { migrationsFolder: resolved.migrationsFolder });
    if (options.injectFailure === "post-check") throw new Error("Injected post-migration validation failure.");
    await resolved.onProgress?.("verifying"); integrity(client);
    const finalApplied = appliedMigrations(client); validateApplied(finalApplied);
    if (finalApplied.length !== releasedMigrations.length) throw new Error("Not all bundled migrations were applied.");
    markDatabasePrepared(resolved.databasePath);
    return { result: !existed ? "fresh" : pending ? "upgraded" : "current", migrated: pending, schemaHead: finalApplied.at(-1)?.name ?? null, sourceSchemaHead, backupPath: snapshot, migrationDigest: migrationDigest() };
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause); try { client.close(); } catch {}
    try {
      if (snapshot) { await replaceDatabase(snapshot, resolved.databasePath); await verifyDatabaseFile(resolved.databasePath); }
      else if (!existed) { await rm(resolved.databasePath, { force: true }); await rm(`${resolved.databasePath}-wal`, { force: true }); await rm(`${resolved.databasePath}-shm`, { force: true }); }
    } catch (recovery) {
      throw new UpgradePreflightError("Database upgrade failed and automatic restoration also failed.", resolved.databasePath, snapshot, `${detail}; restore failure: ${recovery instanceof Error ? recovery.message : String(recovery)}`);
    }
    throw new UpgradePreflightError(snapshot ? "Database upgrade failed; the original database was restored and verified." : "Database startup validation failed before migrations were applied.", resolved.databasePath, snapshot, detail);
  } finally { try { client.close(); } catch {} }
}
