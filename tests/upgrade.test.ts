import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { forgetPreparedDatabase, runDatabasePreflight, UpgradePreflightError } from "@/server/db/upgrade";
import { releasedMigrations, verifyMigrationFiles } from "@/server/db/migration-catalog";

const roots: string[] = []; const migrationsFolder = path.join(process.cwd(), "drizzle");
async function root() { const value = await mkdtemp(path.join(tmpdir(), "psm-upgrade-")); roots.push(value); return value; }
async function migratedPrefix(directory: string, count: number, fixture = false) {
  const databasePath = path.join(directory, "registry-v3.sqlite"); const client = new DatabaseSync(databasePath); client.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  client.exec("CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric);");
  for (const migration of releasedMigrations.slice(0, count)) { const sql = await readFile(path.join(migrationsFolder, migration.name, "migration.sql"), "utf8"); for (const statement of sql.split("--> statement-breakpoint")) client.exec(statement); client.prepare("INSERT INTO __drizzle_migrations(hash,created_at) VALUES(?,?)").run(migration.hash, Date.UTC(Number(migration.name.slice(0, 4)), Number(migration.name.slice(4, 6)) - 1, Number(migration.name.slice(6, 8)), Number(migration.name.slice(8, 10)), Number(migration.name.slice(10, 12)), Number(migration.name.slice(12, 14)))); }
  if (fixture) client.exec(await readFile(path.join(process.cwd(), "tests/fixtures/upgrade-alpha.1.sql"), "utf8"));
  return { databasePath, client };
}
const options = (directory: string) => ({ databasePath: path.join(directory, "registry-v3.sqlite"), dataDirectory: directory, migrationsFolder });
afterEach(async () => { forgetPreparedDatabase(); await Promise.all(roots.splice(0).map((item) => rm(item, { recursive: true, force: true }))); });

describe("database upgrade safety", () => {
  it("initializes a fresh database without a backup", async () => { const directory = await root(); const result = await runDatabasePreflight(options(directory)); expect(result).toMatchObject({ result: "fresh", migrated: true, backupPath: null }); });

  it("upgrades every recognized migration prefix", async () => {
    for (let count = 1; count < releasedMigrations.length; count += 1) { const directory = await root(); const fixture = await migratedPrefix(directory, count); fixture.client.close(); const result = await runDatabasePreflight(options(directory)); expect(result.result, `prefix ${count}`).toBe("upgraded"); }
  });

  it("upgrades alpha.1 through one WAL-safe verified backup", async () => {
    const directory = await root(); const fixture = await migratedPrefix(directory, 6, true); fixture.client.prepare("INSERT INTO events(world_id,kind,message,created_at) VALUES(?,?,?,?)").run("fixture-world", "wal", "Committed in WAL", Date.now());
    const stages: string[] = []; const result = await runDatabasePreflight({ ...options(directory), onProgress: (stage) => { stages.push(stage); } }); fixture.client.close();
    expect(result).toMatchObject({ result: "upgraded", migrated: true, backupPath: path.join(directory, "registry-v3.pre-upgrade.sqlite") }); expect(stages).toEqual(["preparing", "backing-up", "migrating", "verifying"]);
    const upgraded = new DatabaseSync(fixture.databasePath); expect((upgraded.prepare("SELECT count(*) count FROM events").get() as { count: number }).count).toBe(2); expect(upgraded.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" }); upgraded.close();
    const backup = new DatabaseSync(result.backupPath!, { readOnly: true }); expect((backup.prepare("SELECT count(*) count FROM events").get() as { count: number }).count).toBe(2); expect(() => backup.prepare("SELECT * FROM world_settings").all()).toThrow(); backup.close();
    const repeated = await runDatabasePreflight(options(directory)); expect(repeated).toMatchObject({ result: "current", migrated: false, backupPath: null });
  });

  it("restores the original database after migration or validation failure", async () => {
    for (const injectFailure of ["migration", "post-check"] as const) { const directory = await root(); const fixture = await migratedPrefix(directory, 6, true); fixture.client.close(); await expect(runDatabasePreflight({ ...options(directory), injectFailure })).rejects.toBeInstanceOf(UpgradePreflightError); const restored = new DatabaseSync(fixture.databasePath, { readOnly: true }); expect(() => restored.prepare("SELECT * FROM world_settings").all()).toThrow(); expect(restored.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" }); restored.close(); }
  });

  it("never restores a stale fixed-path backup when creating the current backup fails", async () => {
    const directory = await root(); const fixture = await migratedPrefix(directory, 6, true); fixture.client.close();
    const staleBackup = path.join(directory, "registry-v3.pre-upgrade.sqlite"); await cp(fixture.databasePath, staleBackup);
    const live = new DatabaseSync(fixture.databasePath); live.prepare("INSERT INTO events(world_id,kind,message,created_at) VALUES(?,?,?,?)").run("fixture-world", "live-only", "Must survive", Date.now()); live.close();
    await expect(runDatabasePreflight({ ...options(directory), injectFailure: "backup" })).rejects.toMatchObject({ backupPath: null, causeDetail: "Injected backup failure." });
    const unchanged = new DatabaseSync(fixture.databasePath, { readOnly: true }); expect((unchanged.prepare("SELECT count(*) count FROM events WHERE kind='live-only'").get() as { count: number }).count).toBe(1); unchanged.close();
  });

  it("blocks divergent, newer, populated-untracked, and corrupt databases", async () => {
    const divergent = await root(); const fixture = await migratedPrefix(divergent, 1); fixture.client.prepare("UPDATE __drizzle_migrations SET hash='changed'").run(); fixture.client.close(); await expect(runDatabasePreflight(options(divergent))).rejects.toMatchObject({ causeDetail: expect.stringMatching(/ordered prefix/) });
    const newer = await root(); const newerFixture = await migratedPrefix(newer, releasedMigrations.length); newerFixture.client.prepare("INSERT INTO __drizzle_migrations(hash,created_at) VALUES('future',9999999999999)").run(); newerFixture.client.close(); await expect(runDatabasePreflight(options(newer))).rejects.toMatchObject({ causeDetail: expect.stringMatching(/newer application/) });
    const untracked = await root(); const untrackedClient = new DatabaseSync(path.join(untracked, "registry-v3.sqlite")); untrackedClient.exec("CREATE TABLE worlds(id text)"); untrackedClient.close(); await expect(runDatabasePreflight(options(untracked))).rejects.toMatchObject({ causeDetail: expect.stringMatching(/no recognized migration history/) });
    const corrupt = await root(); await writeFile(path.join(corrupt, "registry-v3.sqlite"), "not sqlite"); await expect(runDatabasePreflight(options(corrupt))).rejects.toThrow();
  });

  it("locks every released migration to its catalog hash", async () => { expect(() => verifyMigrationFiles(migrationsFolder)).not.toThrow(); const directory = await root(); await cp(migrationsFolder, directory, { recursive: true }); await writeFile(path.join(directory, releasedMigrations[0].name, "migration.sql"), "SELECT 1;"); expect(() => verifyMigrationFiles(directory)).toThrow("modified"); });
});
