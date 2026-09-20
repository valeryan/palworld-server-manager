import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathsOverlap } from "@/server/services/worlds";
import { parseArguments } from "@/server/services/processes";
import { createWorldSchema } from "@/contracts/world";

describe("world isolation", () => {
  it("detects equal and nested paths", () => {
    expect(pathsOverlap("/srv/pal/a", "/srv/pal/a")).toBe(true);
    expect(pathsOverlap("/srv/pal/a", "/srv/pal/a/Saved")).toBe(true);
    expect(pathsOverlap("/srv/pal/a", "/srv/pal/ab")).toBe(false);
  });
  it("rejects invalid ports", () => { expect(() => createWorldSchema.parse({ displayName: "x", installDir: "/tmp/x", gamePort: 70_000 })).toThrow(); });
});

describe("launch argument parser", () => {
  it("preserves quoted values without invoking a shell", () => { expect(parseArguments(`-flag "hello world" 'two words' plain`)).toEqual(["-flag", "hello world", "two words", "plain"]); });
  it("rejects unfinished quotes", () => { expect(() => parseArguments(`"unfinished`)).toThrow(); });
});

describe("legacy import", () => {
  let directory: string | undefined;
  afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

  it("reads the legacy database without modifying it and preserves world ids", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "psm-import-test-"));
    const sourcePath = path.join(directory, "registry.sqlite");
    const legacy = new DatabaseSync(sourcePath);
    legacy.exec(`
      CREATE TABLE worlds (world_id TEXT PRIMARY KEY, display_name TEXT NOT NULL, install_dir TEXT NOT NULL, platform TEXT, game_port INTEGER, query_port INTEGER, rest_api_port INTEGER, rcon_port INTEGER, admin_password TEXT, rest_api_enabled INTEGER, rcon_enabled INTEGER, status TEXT, autostart INTEGER, crash_guard INTEGER, created_at INTEGER);
      CREATE TABLE events (id INTEGER PRIMARY KEY, world_id TEXT, kind TEXT, message TEXT, created_at INTEGER);
      CREATE TABLE sessions (id INTEGER PRIMARY KEY, world_id TEXT, user_id TEXT, player_name TEXT, event TEXT, created_at INTEGER);
      CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT);
    `);
    legacy.prepare("INSERT INTO worlds VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("legacy-world", "Legacy", path.join(directory, "server"), "linux", 20101, 20102, 20103, 20104, "secret", 1, 0, "stopped", 0, 1, Date.now());
    legacy.prepare("INSERT INTO events VALUES (1, 'legacy-world', 'start', 'Started', ?)").run(Date.now());
    legacy.prepare("INSERT INTO sessions VALUES (1, 'legacy-world', 'player-1', 'Tester', 'join', ?)").run(Date.now());
    legacy.prepare("INSERT INTO app_settings VALUES ('language', '\"en\"')").run();
    legacy.close();
    const before = await readFile(sourcePath);
    process.env.PALWORLD_MANAGER_DATA_DIR = path.join(directory, "next-data");
    process.env.PALWORLD_MANAGER_DB = path.join(directory, "next-data", "registry-v3.sqlite");
    const { importLegacyDatabase } = await import("@/server/services/legacy-import");
    const { getWorld } = await import("@/server/services/worlds");
    const report = await importLegacyDatabase(sourcePath);
    expect(report.imported).toEqual(["legacy-world"]);
    expect(report.counts).toMatchObject({ worlds: 1, events: 1, sessions: 1, app_settings: 1 });
    expect(report.verification).toEqual({ worldCount: 1, relationshipErrors: 0, criticalFieldsPresent: true });
    expect((await getWorld("legacy-world"))?.displayName).toBe("Legacy");
    expect(await readFile(sourcePath)).toEqual(before);
  });
});
