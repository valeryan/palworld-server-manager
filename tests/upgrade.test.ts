import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { forgetPreparedDatabase, INCOMPATIBLE_DATABASE_MESSAGE, runDatabasePreflight, UpgradePreflightError } from "@/server/db/upgrade";
import { releasedMigrations, verifyMigrationFiles, type MigrationCatalog } from "@/server/db/migration-catalog";

// The released catalog holds one baseline migration, so the upgrade path is exercised with a
// synthetic later migration in a copy of the bundled folder.
const roots: string[] = []; const migrationsFolder = path.join(process.cwd(), "drizzle");
const PROBE = "29991231000000_upgrade_probe"; const probeSql = "CREATE TABLE upgrade_probe (id integer PRIMARY KEY);\n--> statement-breakpoint\nALTER TABLE worlds ADD upgrade_probe text;";
async function root() { const value = await mkdtemp(path.join(tmpdir(), "psm-upgrade-")); roots.push(value); return value; }
const options = (directory: string) => ({ databasePath: path.join(directory, "registry-v3.sqlite"), dataDirectory: directory, migrationsFolder });
async function withProbeMigration(directory: string): Promise<{ migrationsFolder: string; catalog: MigrationCatalog }> {
  const folder = path.join(directory, "migrations"); await cp(migrationsFolder, folder, { recursive: true });
  await mkdir(path.join(folder, PROBE)); await writeFile(path.join(folder, PROBE, "migration.sql"), probeSql);
  return { migrationsFolder: folder, catalog: [...releasedMigrations, { name: PROBE, hash: createHash("sha256").update(probeSql).digest("hex") }] };
}
/** A database at the released baseline with a few rows, the way an installed milestone leaves it. */
async function baseline(directory: string) {
  await runDatabasePreflight(options(directory)); forgetPreparedDatabase();
  const client = new DatabaseSync(path.join(directory, "registry-v3.sqlite")); client.exec("PRAGMA journal_mode=WAL;");
  const now = Date.now();
  client.prepare("INSERT INTO worlds(id,display_name,install_dir,game_port,query_port,rest_api_port,rcon_port,created_at,updated_at) VALUES('fixture-world','Fixture','/tmp/fixture',8211,27015,8212,25575,?,?)").run(now, now);
  client.prepare("INSERT INTO events(world_id,kind,message,created_at) VALUES('fixture-world','fixture','Baseline event',?)").run(now);
  client.prepare("INSERT INTO jobs(id,world_id,kind,state,created_at) VALUES('fixture-job','fixture-world','backup','succeeded',?)").run(now);
  return { databasePath: path.join(directory, "registry-v3.sqlite"), client };
}
const count = (client: DatabaseSync, table: string) => (client.prepare(`SELECT count(*) count FROM ${table}`).get() as { count: number }).count;
afterEach(async () => { forgetPreparedDatabase(); await Promise.all(roots.splice(0).map((item) => rm(item, { recursive: true, force: true }))); });

describe("database upgrade safety", () => {
  it("initializes a fresh database without a backup and reports it current afterwards", async () => {
    const directory = await root();
    expect(await runDatabasePreflight(options(directory))).toMatchObject({ result: "fresh", migrated: true, backupPath: null, schemaHead: releasedMigrations[0]!.name });
    forgetPreparedDatabase();
    expect(await runDatabasePreflight(options(directory))).toMatchObject({ result: "current", migrated: false, backupPath: null });
    const client = new DatabaseSync(path.join(directory, "registry-v3.sqlite"), { readOnly: true });
    expect(count(client, "__drizzle_migrations")).toBe(1); expect(() => client.prepare("SELECT * FROM world_players").all()).not.toThrow(); client.close();
  });

  it("upgrades the baseline through one WAL-safe verified backup", async () => {
    const directory = await root(); const fixture = await baseline(directory); fixture.client.prepare("INSERT INTO events(world_id,kind,message,created_at) VALUES('fixture-world','wal','Committed in WAL',?)").run(Date.now());
    const probe = await withProbeMigration(directory); const stages: string[] = [];
    const result = await runDatabasePreflight({ ...options(directory), ...probe, onProgress: (stage) => { stages.push(stage); } }); fixture.client.close();
    expect(result).toMatchObject({ result: "upgraded", migrated: true, schemaHead: PROBE, sourceSchemaHead: releasedMigrations[0]!.name, backupPath: path.join(directory, "registry-v3.pre-upgrade.sqlite") }); expect(stages).toEqual(["preparing", "backing-up", "migrating", "verifying"]);
    const upgraded = new DatabaseSync(fixture.databasePath); expect(count(upgraded, "events")).toBe(2); expect(count(upgraded, "upgrade_probe")).toBe(0); expect(upgraded.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" }); upgraded.close();
    const backup = new DatabaseSync(result.backupPath!, { readOnly: true }); expect(count(backup, "events")).toBe(2); expect(() => backup.prepare("SELECT * FROM upgrade_probe").all()).toThrow(); backup.close();
    forgetPreparedDatabase();
    expect(await runDatabasePreflight({ ...options(directory), ...probe })).toMatchObject({ result: "current", migrated: false, backupPath: null });
  });

  it("restores the original database after migration or validation failure", async () => {
    for (const injectFailure of ["migration", "post-check"] as const) {
      const directory = await root(); const fixture = await baseline(directory); fixture.client.close(); const probe = await withProbeMigration(directory);
      await expect(runDatabasePreflight({ ...options(directory), ...probe, injectFailure })).rejects.toBeInstanceOf(UpgradePreflightError);
      const restored = new DatabaseSync(fixture.databasePath, { readOnly: true }); expect(() => restored.prepare("SELECT * FROM upgrade_probe").all()).toThrow(); expect(count(restored, "worlds")).toBe(1); expect(restored.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" }); restored.close();
    }
  });

  it("never restores a stale fixed-path backup when creating the current backup fails", async () => {
    const directory = await root(); const fixture = await baseline(directory); fixture.client.close(); const probe = await withProbeMigration(directory);
    const staleBackup = path.join(directory, "registry-v3.pre-upgrade.sqlite"); await cp(fixture.databasePath, staleBackup);
    const live = new DatabaseSync(fixture.databasePath); live.prepare("INSERT INTO events(world_id,kind,message,created_at) VALUES('fixture-world','live-only','Must survive',?)").run(Date.now()); live.close();
    await expect(runDatabasePreflight({ ...options(directory), ...probe, injectFailure: "backup" })).rejects.toMatchObject({ backupPath: null, causeDetail: "Injected backup failure." });
    const unchanged = new DatabaseSync(fixture.databasePath, { readOnly: true }); expect((unchanged.prepare("SELECT count(*) count FROM events WHERE kind='live-only'").get() as { count: number }).count).toBe(1); unchanged.close();
  });

  it("blocks divergent, newer, earlier-development, populated-untracked, and corrupt databases", async () => {
    const divergent = await root(); const fixture = await baseline(divergent); fixture.client.prepare("UPDATE __drizzle_migrations SET hash='changed'").run(); fixture.client.close(); await expect(runDatabasePreflight(options(divergent))).rejects.toMatchObject({ causeDetail: expect.stringMatching(/ordered prefix/) });
    const newer = await root(); const newerFixture = await baseline(newer); newerFixture.client.prepare("INSERT INTO __drizzle_migrations(hash,created_at,name,applied_at) VALUES('future',9999999999999,'29991231000000_future','2999-12-31')").run(); newerFixture.client.close(); await expect(runDatabasePreflight(options(newer))).rejects.toMatchObject({ causeDetail: expect.stringMatching(/newer application/) });
    const earlier = await root(); const earlierClient = new DatabaseSync(path.join(earlier, "registry-v3.sqlite")); earlierClient.exec("CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric, name text, applied_at text); CREATE TABLE worlds(id text);"); earlierClient.prepare("INSERT INTO __drizzle_migrations(hash,created_at,name,applied_at) VALUES('old',1,'20260920061630_smiling_roxanne_simpson','2026-09-20')").run(); earlierClient.close(); await expect(runDatabasePreflight(options(earlier))).rejects.toMatchObject({ causeDetail: INCOMPATIBLE_DATABASE_MESSAGE });
    const nameless = await root(); const namelessClient = new DatabaseSync(path.join(nameless, "registry-v3.sqlite")); namelessClient.exec("CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric); CREATE TABLE worlds(id text);"); namelessClient.prepare("INSERT INTO __drizzle_migrations(hash,created_at) VALUES('legacy-hash',1)").run(); namelessClient.close(); await expect(runDatabasePreflight(options(nameless))).rejects.toMatchObject({ causeDetail: INCOMPATIBLE_DATABASE_MESSAGE });
    const untracked = await root(); const untrackedClient = new DatabaseSync(path.join(untracked, "registry-v3.sqlite")); untrackedClient.exec("CREATE TABLE worlds(id text)"); untrackedClient.close(); await expect(runDatabasePreflight(options(untracked))).rejects.toMatchObject({ causeDetail: expect.stringMatching(/no recognized migration history/) });
    const corrupt = await root(); await writeFile(path.join(corrupt, "registry-v3.sqlite"), "not sqlite"); await expect(runDatabasePreflight(options(corrupt))).rejects.toThrow();
  });

  it("locks the released migration to its catalog hash and refuses extra or modified files", async () => {
    expect(releasedMigrations).toHaveLength(1); expect(() => verifyMigrationFiles(migrationsFolder)).not.toThrow();
    const modified = await root(); await cp(migrationsFolder, modified, { recursive: true }); await writeFile(path.join(modified, releasedMigrations[0]!.name, "migration.sql"), "SELECT 1;"); expect(() => verifyMigrationFiles(modified)).toThrow("modified");
    const extra = await root(); const probe = await withProbeMigration(extra); expect(() => verifyMigrationFiles(probe.migrationsFolder)).toThrow("does not match"); expect(() => verifyMigrationFiles(probe.migrationsFolder, probe.catalog)).not.toThrow();
  });
});
