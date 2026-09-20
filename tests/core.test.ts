import { afterAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { adoptWorld, pathsOverlap } from "@/server/services/worlds";
import { commandFor, parseArguments } from "@/server/services/processes";
import { createWorldSchema, parseWorldUpdate } from "@/contracts/world";
import { createScheduleSchema } from "@/contracts/schedule";
import { nextRun } from "@/server/services/schedules";
import { applyConfigurationOptions, managedConfigurationChanges, parseConfigurationOptions } from "@/server/services/configuration";

describe("world isolation", () => {
  it("detects equal and nested paths", () => {
    expect(pathsOverlap("/srv/pal/a", "/srv/pal/a")).toBe(true);
    expect(pathsOverlap("/srv/pal/a", "/srv/pal/a/Saved")).toBe(true);
    expect(pathsOverlap("/srv/pal/a", "/srv/pal/ab")).toBe(false);
  });
  it("rejects invalid ports", () => { expect(() => createWorldSchema.parse({ displayName: "x", installDir: "/tmp/x", gamePort: 70_000 })).toThrow(); });
  it("rejects adoption when the platform executable is missing", async () => {
    await expect(adoptWorld({ displayName: "missing", installDir: path.join(tmpdir(), "psm-missing-install"), platform: "linux" })).rejects.toThrow("missing PalServer.sh");
  });
  it("does not apply creation defaults to omitted update fields", () => {
    expect(parseWorldUpdate({ displayName: "Renamed" })).toEqual({ displayName: "Renamed" });
    expect(parseWorldUpdate({ displayName: "Renamed" })).not.toHaveProperty("adminPassword");
  });
});

describe("launch argument parser", () => {
  it("preserves quoted values without invoking a shell", () => { expect(parseArguments(`-flag "hello world" 'two words' plain`)).toEqual(["-flag", "hello world", "two words", "plain"]); });
  it("rejects unfinished quotes", () => { expect(() => parseArguments(`"unfinished`)).toThrow(); });
  it("enables configured REST and RCON endpoints explicitly", () => {
    const command = commandFor(createWorldSchema.parse({ displayName: "test", installDir: "/srv/pal", restApiEnabled: true, rconEnabled: true }) as never);
    expect(command.args).toContain("-RESTAPIEnabled=true"); expect(command.args).toContain("-RCONEnabled=true");
  });
});

describe("schedules", () => {
  it("calculates interval runs from the current time", () => {
    expect(nextRun({ mode: "interval", intervalMinutes: 15 }, 1_000)).toBe(901_000);
  });
  it("rolls an elapsed daily time into the next day", () => {
    const now = new Date(2026, 8, 20, 12, 0, 0).getTime();
    expect(new Date(nextRun({ mode: "daily", timeOfDay: "04:30" }, now)).getDate()).toBe(21);
  });
  it("rejects invalid intervals and daily times", () => {
    expect(() => createScheduleSchema.parse({ action: "backup", mode: "interval", intervalMinutes: 0 })).toThrow();
    expect(() => createScheduleSchema.parse({ action: "restart", mode: "daily", timeOfDay: "25:00" })).toThrow();
  });
});

describe("PalWorldSettings transformations", () => {
  const ini = "[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(ServerName=\"Family, \\\"Friends\\\"\",ExpRate=1.000000,RegionBanListURL=\"\",SomeTuple=(X=1,Y=2))\n";
  it("parses quoted commas and nested tuples", () => {
    expect(parseConfigurationOptions(ini)).toMatchObject({ ServerName: '"Family, \\\"Friends\\\""', ExpRate: "1.000000", SomeTuple: "(X=1,Y=2)" });
  });
  it("updates only selected settings and preserves unknown values", () => {
    const changed = applyConfigurationOptions(ini, { ExpRate: "2.5", bEnableFastTravel: "True" });
    expect(parseConfigurationOptions(changed)).toMatchObject({ ServerName: '"Family, \\\"Friends\\\""', ExpRate: "2.5", SomeTuple: "(X=1,Y=2)", bEnableFastTravel: "True" });
  });
  it("maps manager-owned network and credential values", () => {
    const world = { ...createWorldSchema.parse({ displayName: "Test", installDir: "/tmp/test", gamePort: 8211, restApiPort: 8213, rconPort: 25575, adminPassword: "a\"b", serverPassword: "secret", restApiEnabled: true, rconEnabled: false }), id: "world", status: "stopped" as const, processId: null, buildId: null, latestBuildId: null, createdAt: 1, updatedAt: 1 };
    expect(managedConfigurationChanges(world)).toMatchObject({ PublicPort: "8211", AdminPassword: '"a\\\"b"', ServerPassword: '"secret"', RESTAPIEnabled: "True", RESTAPIPort: "8213", RCONEnabled: "False", RCONPort: "25575" });
  });
  it("never erases game credentials when registry credentials are absent", () => {
    const world = { ...createWorldSchema.parse({ displayName: "Test", installDir: "/tmp/test", adminPassword: "", serverPassword: "" }), id: "world", status: "stopped" as const, processId: null, buildId: null, latestBuildId: null, createdAt: 1, updatedAt: 1 };
    expect(managedConfigurationChanges(world)).not.toHaveProperty("AdminPassword");
    expect(managedConfigurationChanges(world)).not.toHaveProperty("ServerPassword");
  });
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
    legacy.prepare("INSERT INTO worlds VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("legacy-world", "Legacy", path.join(directory, "server"), "linux", 20101, 20102, 20103, 20104, "", 1, 0, "stopped", 0, 1, Date.now());
    legacy.prepare("INSERT INTO events VALUES (1, 'legacy-world', 'start', 'Started', ?)").run(Date.now());
    legacy.prepare("INSERT INTO sessions VALUES (1, 'legacy-world', 'player-1', 'Tester', 'join', ?)").run(Date.now());
    legacy.prepare("INSERT INTO app_settings VALUES ('language', '\"en\"')").run();
    legacy.close();
    const configDirectory = path.join(directory, "server", "Pal", "Saved", "Config", "LinuxServer");
    await mkdir(configDirectory, { recursive: true });
    await writeFile(path.join(configDirectory, "PalWorldSettings.ini"), '[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(AdminPassword="from-ini",ServerPassword="players")\n');
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
    expect((await getWorld("legacy-world"))?.adminPassword).toBe("from-ini");
    expect((await getWorld("legacy-world"))?.serverPassword).toBe("players");
    expect(await readFile(sourcePath)).toEqual(before);
  });
});
