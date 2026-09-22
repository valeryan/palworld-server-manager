import { afterAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { adoptWorld, exportWorldRegistration, pathsOverlap } from "@/server/services/worlds";
import { commandFor, parseArguments } from "@/server/services/processes";
import { createWorldSchema, parseWorldUpdate, worldRegistrationSchema } from "@/contracts/world";
import { createScheduleSchema } from "@/contracts/schedule";
import { nextRun } from "@/server/services/schedules";
import { applyConfigurationOptions, managedConfigurationChanges, needsManagedConfigurationSync, parseConfigurationOptions } from "@/server/services/configuration";
import { PALWORLD_SETTING_FIELDS, validateAndEncodeSettingChanges } from "@/contracts/palworld-settings";
import { cancelJob, listJobs, startJob } from "@/server/services/jobs";
import { backupSettingsSchema } from "@/contracts/backup";
import { retentionCandidates } from "@/server/services/backups";
import { warningMessage } from "@/server/services/maintenance";
import { jobDisplayMessage, jobKindLabel, jobStartingMessage, jobSuccessMessage } from "@/lib/job-presentation";
import { rconCommandSchema, restAdminActionSchema } from "@/contracts/admin";
import { buildState, buildStatusText } from "@/lib/build-presentation";
import { legacyModerationEvent, moderationEventMessage } from "@/lib/moderation-presentation";
import { defaultRetentionSettings, retentionSettingsSchema } from "@/contracts/retention";

describe("history retention settings", () => {
  it("accepts conservative defaults and coerces settings form values", () => {
    expect(retentionSettingsSchema.parse(defaultRetentionSettings)).toEqual(defaultRetentionSettings);
    expect(retentionSettingsSchema.parse({ ...defaultRetentionSettings, operationDays: "90" })).toMatchObject({ operationDays: 90 });
  });
  it("rejects limits that could erase nearly all useful history", () => {
    expect(() => retentionSettingsSchema.parse({ ...defaultRetentionSettings, operationCount: 1 })).toThrow();
    expect(() => retentionSettingsSchema.parse({ ...defaultRetentionSettings, serverLogFilesPerWorld: 0 })).toThrow();
  });
});

describe("moderation activity presentation", () => {
  it("shows a readable player name without losing the immutable user ID", () => {
    expect(moderationEventMessage("ban", "gdk_123", "Valeryan")).toBe("Banned Valeryan (gdk_123)");
    expect(moderationEventMessage("unban", "gdk_123")).toBe("Unbanned gdk_123");
  });
  it("recognizes ID-only events written by earlier builds", () => {
    expect(legacyModerationEvent("Kick completed for gdk_123")).toEqual({ action: "kick", userId: "gdk_123" });
    expect(legacyModerationEvent("Saved the world")).toBeNull();
  });
});

describe("build presentation", () => {
  it("distinguishes current, outdated, and unchecked builds", () => {
    expect(buildState("100", "100")).toBe("current");
    expect(buildState("100", "101")).toBe("update-available");
    expect(buildState("100", null)).toBe("unknown");
  });
  it("keeps both build IDs in the accessible update description", () => {
    expect(buildStatusText("100", "101")).toContain("installed build 100; latest public build 101");
  });
});

describe("operation language", () => {
  it("describes lifecycle actions without calling every operation starting", () => {
    expect(jobKindLabel("stop")).toBe("Stop server");
    expect(jobStartingMessage("stop")).toBe("Stopping server");
    expect(jobStartingMessage("backup")).toBe("Creating backup");
    expect(jobSuccessMessage("restart")).toBe("Server restarted successfully");
  });
  it("presents legacy generic job messages with action-specific language", () => {
    expect(jobDisplayMessage({ kind: "stop", state: "running", message: "Starting" })).toBe("Stopping server");
    expect(jobDisplayMessage({ kind: "stop", state: "succeeded", message: "Complete" })).toBe("Server stopped successfully");
  });
});

describe("live administration contracts", () => {
  it("validates REST administration actions and trims identifiers", () => {
    expect(restAdminActionSchema.parse({ action: "kick", userId: " player-1 " })).toMatchObject({ action: "kick", userId: "player-1" });
    expect(restAdminActionSchema.parse({ action: "announce", message: " Maintenance soon " })).toMatchObject({ message: "Maintenance soon" });
    expect(() => restAdminActionSchema.parse({ action: "announce", message: "" })).toThrow();
    expect(() => restAdminActionSchema.parse({ action: "shutdown" })).toThrow();
  });
  it("rejects blank and unbounded legacy RCON commands", () => {
    expect(rconCommandSchema.parse({ command: "  Info  " }).command).toBe("Info");
    expect(() => rconCommandSchema.parse({ command: "" })).toThrow();
    expect(() => rconCommandSchema.parse({ command: "x".repeat(1_001) })).toThrow();
  });
});

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
  it("exports a versioned portable registration without credentials or autostart", () => {
    const input = createWorldSchema.parse({ displayName: "Portable", installDir: "/srv/pal/portable", adminPassword: "admin-secret", serverPassword: "player-secret", autostart: true, env: { CUSTOM_FLAG: "enabled" } });
    const registration = exportWorldRegistration({ ...input, id: "portable-world", status: "stopped", processId: null, buildId: null, latestBuildId: null, lastStartedAt: null, createdAt: 1, updatedAt: 1 });
    expect(worldRegistrationSchema.parse(registration)).toEqual(registration);
    expect(registration.world).not.toHaveProperty("adminPassword");
    expect(registration.world).not.toHaveProperty("serverPassword");
    expect(registration.world.autostart).toBe(false);
    expect(registration.world.env).toEqual({ CUSTOM_FLAG: "enabled" });
  });
  it("rejects unsupported or credential-bearing registration documents", () => {
    const base = { format: "psm-next/world-registration", version: 1, exportedAt: new Date().toISOString(), sourceWorldId: "source", world: { displayName: "Portable", installDir: "/srv/pal/portable" } };
    expect(() => worldRegistrationSchema.parse({ ...base, version: 2 })).toThrow();
    expect(() => worldRegistrationSchema.parse({ ...base, world: { ...base.world, adminPassword: "secret" } })).toThrow();
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
    expect(new Date(nextRun({ mode: "daily", timeOfDay: "04:30" }, now)!).getDate()).toBe(21);
  });
  it("rejects invalid intervals and daily times", () => {
    expect(() => createScheduleSchema.parse({ action: "backup", mode: "interval", intervalMinutes: 0 })).toThrow();
    expect(() => createScheduleSchema.parse({ action: "restart", mode: "daily", timeOfDay: "25:00" })).toThrow();
  });
  it("validates the original manager action and trigger combinations", () => {
    expect(createScheduleSchema.parse({ action: "stop", mode: "daily", timeOfDay: "04:00" }).action).toBe("stop");
    expect(createScheduleSchema.parse({ action: "system_message", mode: "on_join", message: "Welcome {player}", joinDelaySeconds: 5 }).mode).toBe("on_join");
    expect(createScheduleSchema.parse({ action: "custom_http", mode: "minutes", intervalMinutes: 30, httpMethod: "POST", httpUrl: "https://example.test/hook" }).action).toBe("custom_http");
    expect(() => createScheduleSchema.parse({ action: "idle_stop", mode: "daily", timeOfDay: "04:00" })).toThrow("Stop-when-empty");
    expect(() => createScheduleSchema.parse({ action: "custom_http", mode: "minutes", intervalMinutes: 30, httpUrl: "ftp://example.test/file" })).toThrow("Only HTTP and HTTPS");
  });
  it("calculates hour, minute, event-driven, and warning values", () => {
    expect(nextRun({ mode: "interval", intervalHours: 2 }, 1_000)).toBe(7_201_000);
    expect(nextRun({ mode: "minutes", intervalMinutes: 5 }, 1_000)).toBe(301_000);
    expect(nextRun({ mode: "on_join" }, 1_000)).toBeNull();
    expect(warningMessage("{action} in {minutes}m ({seconds}s)", "restart", 90)).toBe("restart in 2m (90s)");
  });
});

describe("backup policy", () => {
  it("uses unlimited retention by default and validates configured limits", () => {
    expect(backupSettingsSchema.parse({})).toEqual({ destinationDir: null, retentionCount: 0 });
    expect(() => backupSettingsSchema.parse({ retentionCount: 501 })).toThrow();
  });
  it("expires only the oldest records and always protects the new backup", () => {
    const records = ["one", "two", "three", "new"].map((id) => ({ id }));
    expect(retentionCandidates(records, 2, "new").map((record) => record.id)).toEqual(["one", "two"]);
    expect(retentionCandidates(records, 0, "new")).toEqual([]);
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
    const world = { ...createWorldSchema.parse({ displayName: "Test", installDir: "/tmp/test", gamePort: 8211, restApiPort: 8213, rconPort: 25575, adminPassword: "a\"b", serverPassword: "secret", restApiEnabled: true, rconEnabled: false }), id: "world", status: "stopped" as const, processId: null, buildId: null, latestBuildId: null, lastStartedAt: null, createdAt: 1, updatedAt: 1 };
    expect(managedConfigurationChanges(world, { syncPublicPort: true })).toMatchObject({ PublicPort: "8211", AdminPassword: '"a\\\"b"', ServerPassword: '"secret"', RESTAPIEnabled: "True", RESTAPIPort: "8213", RCONEnabled: "False", RCONPort: "25575" });
    expect(managedConfigurationChanges(world)).not.toHaveProperty("PublicPort");
  });
  it("never erases game credentials when registry credentials are absent", () => {
    const world = { ...createWorldSchema.parse({ displayName: "Test", installDir: "/tmp/test", adminPassword: "", serverPassword: "" }), id: "world", status: "stopped" as const, processId: null, buildId: null, latestBuildId: null, lastStartedAt: null, createdAt: 1, updatedAt: 1 };
    expect(managedConfigurationChanges(world)).not.toHaveProperty("AdminPassword");
    expect(managedConfigurationChanges(world)).not.toHaveProperty("ServerPassword");
  });
  it("preserves an explicitly advertised public port during routine synchronization", () => {
    const world = { ...createWorldSchema.parse({ displayName: "Test", installDir: "/tmp/test", gamePort: 8211 }), id: "world", status: "stopped" as const, processId: null, buildId: null, latestBuildId: null, lastStartedAt: null, createdAt: 1, updatedAt: 1 };
    const content = applyConfigurationOptions("[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(PublicPort=49000)\n", managedConfigurationChanges(world));
    expect(parseConfigurationOptions(content).PublicPort).toBe("49000");
  });
  it("does not rewrite the INI for PSM-only presentation changes", () => {
    expect(needsManagedConfigurationSync({ displayName: "Local label" })).toBe(false);
    expect(needsManagedConfigurationSync({ autostart: true, extraArgs: "-useperfthreads" })).toBe(false);
    expect(needsManagedConfigurationSync({ adminPassword: "new", restApiPort: 8213 })).toBe(true);
    expect(needsManagedConfigurationSync({ gamePort: 8211 })).toBe(true);
  });
  it("exposes and validates the complete original structured field inventory", () => {
    expect(PALWORLD_SETTING_FIELDS).toHaveLength(116);
    expect(validateAndEncodeSettingChanges({ BaseCampWorkerMaxNum: 50, DeathPenalty: "Item", bEnableFastTravel: false })).toEqual({ BaseCampWorkerMaxNum: "50", DeathPenalty: '"Item"', bEnableFastTravel: "False" });
    expect(() => validateAndEncodeSettingChanges({ BaseCampWorkerMaxNum: 51 })).toThrow("cannot be higher than 50");
    expect(() => validateAndEncodeSettingChanges({ DeathPenalty: "Everything" })).toThrow("must be one of");
    expect(() => validateAndEncodeSettingChanges({ UnknownSetting: true })).toThrow("Unknown structured setting");
  });
  it("accounts for every setting in the tested Palworld 1.0.5 template", async () => {
    const template = await readFile(path.join(process.cwd(), "tests/fixtures/DefaultPalWorldSettings-1.0.5.ini"), "utf8");
    const templateKeys = Object.keys(parseConfigurationOptions(template)).sort();
    const managerOwned = ["AdminPassword", "RCONEnabled", "RCONPort", "RESTAPIEnabled", "RESTAPIPort", "ServerPassword"];
    const representedKeys = [...PALWORLD_SETTING_FIELDS.map((field) => field.key), ...managerOwned].sort();
    expect(templateKeys).toHaveLength(122);
    expect(representedKeys).toEqual(templateKeys);
    const options = parseConfigurationOptions(template);
    for (const field of PALWORLD_SETTING_FIELDS) {
      const raw = options[field.key];
      if (field.type === "bool") expect(raw, field.key).toBe(field.default ? "True" : "False");
      else if (field.type === "int" || field.type === "float") expect(Number(raw), field.key).toBe(field.default);
      else if (field.type === "tuple") expect(raw, field.key).toBe(field.default);
      else expect(raw?.replace(/^"|"$/g, ""), field.key).toBe(field.default);
    }
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
  it("cancels an attached long-running job and records cancellation", async () => {
    const id = await startJob(null, "cancel-test", async ({ signal }) => await new Promise<void>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    await cancelJob(id);
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const job = (await listJobs(500)).find((item) => item.id === id);
      if (job?.state === "cancelled") { expect(job.finishedAt).not.toBeNull(); return; }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("Cancelled job did not settle.");
  });
});
