import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import path from "node:path";
import { setupTestDataDirectory } from "./prepare-database";
import { adoptWorld } from "@/server/services/installation";
import { exportWorldRegistration, pathsOverlap } from "@/server/services/worlds";
import { commandFor, parseArguments } from "@/server/services/lifecycle";
import { createWorldSchema, parseWorldUpdate, worldRegistrationSchema } from "@/contracts/world";
import { createScheduleSchema } from "@/contracts/schedule";
import { nextRun } from "@/server/services/schedules";
import { applyConfigurationOptions, configurationCredentials, parseConfigurationOptions } from "@/lib/palworld-ini";
import { advertisedPortState, managedConfigurationChanges, managedDisplayNameChange, managedPublicPortChange, managedWorldChangesFromConfiguration } from "@/server/services/configuration";
import { decodeDefaultSettingValue, decodeSettingValue, PALWORLD_MANAGER_SETTING_KEYS, PALWORLD_SETTING_FIELDS, PALWORLD_SETTING_TABS, settingLayoutSpan, settingPresentation, validateAndEncodeSettingChanges } from "@/contracts/palworld-settings";
import { cancelJob, listJobs, startJob } from "@/server/services/jobs";
import { backupSettingsSchema } from "@/contracts/backup";
import { retentionCandidates } from "@/server/services/backups";
import { warningMessage } from "@/server/services/maintenance";
import { jobKindLabel, jobStartingMessage, jobSuccessMessage } from "@/lib/job-presentation";
import { rconCommandSchema, restAdminActionSchema } from "@/contracts/admin";
import { buildState } from "@/lib/build-presentation";
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
});

describe("operation language", () => {
  it("describes lifecycle actions without calling every operation starting", () => {
    expect(jobKindLabel("stop")).toBe("Stop server");
    expect(jobStartingMessage("stop")).toBe("Stopping server");
    expect(jobStartingMessage("backup")).toBe("Creating backup");
    expect(jobSuccessMessage("restart")).toBe("Server restarted successfully");
    expect(jobStartingMessage("steamcmd-bootstrap")).toBe("Preparing SteamCMD");
    expect(jobSuccessMessage("repair-prerequisites")).toBe("Windows prerequisites repaired");
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
    expect(() => worldRegistrationSchema.parse({ ...base, version: 3 })).toThrow();
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
    const source = ini.replace("SomeTuple=(X=1,Y=2)", "SomeTuple=(X=1,Y=2),ServerReplicatePawnCullDistance=NaN");
    const changed = applyConfigurationOptions(source, { ExpRate: "2.5", bEnableFastTravel: "True" });
    expect(parseConfigurationOptions(changed)).toMatchObject({ ServerName: '"Family, \\\"Friends\\\""', ExpRate: "2.5", SomeTuple: "(X=1,Y=2)", ServerReplicatePawnCullDistance: "NaN", bEnableFastTravel: "True" });
  });
  it("maps manager-owned network values without duplicating INI credentials", () => {
    const world = { ...createWorldSchema.parse({ displayName: "Test", installDir: "/tmp/test", gamePort: 8211, restApiPort: 8213, rconPort: 25575, adminPassword: "a\"b", serverPassword: "secret", restApiEnabled: true, rconEnabled: false }), id: "world", status: "stopped" as const, processId: null, buildId: null, latestBuildId: null, lastStartedAt: null, createdAt: 1, updatedAt: 1 };
    expect(managedConfigurationChanges(world, { syncPublicPort: true })).toEqual({ PublicPort: "8211", RESTAPIEnabled: "True", RESTAPIPort: "8213", RCONEnabled: "False", RCONPort: "25575" });
    expect(managedConfigurationChanges(world)).not.toHaveProperty("PublicPort");
  });
  it("never erases game credentials when registry credentials are absent", () => {
    const world = { ...createWorldSchema.parse({ displayName: "Test", installDir: "/tmp/test", adminPassword: "", serverPassword: "" }), id: "world", status: "stopped" as const, processId: null, buildId: null, latestBuildId: null, lastStartedAt: null, createdAt: 1, updatedAt: 1 };
    expect(managedConfigurationChanges(world)).not.toHaveProperty("AdminPassword");
    expect(managedConfigurationChanges(world)).not.toHaveProperty("ServerPassword");
  });
  it("always writes the server password as a quoted string, including an open server", () => {
    expect(validateAndEncodeSettingChanges({ ServerPassword: "" }).ServerPassword).toBe('""');
    expect(validateAndEncodeSettingChanges({ ServerPassword: "secret" }).ServerPassword).toBe('"secret"');
    expect(applyConfigurationOptions('[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(ServerPassword="old",PublicPort=8211)\n', validateAndEncodeSettingChanges({ ServerPassword: "" }))).toContain('ServerPassword="",');
  });
  it("preserves an explicitly advertised public port during routine synchronization", () => {
    const world = { ...createWorldSchema.parse({ displayName: "Test", installDir: "/tmp/test", gamePort: 8211 }), id: "world", status: "stopped" as const, processId: null, buildId: null, latestBuildId: null, lastStartedAt: null, createdAt: 1, updatedAt: 1 };
    const content = applyConfigurationOptions("[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(PublicPort=49000)\n", managedConfigurationChanges(world));
    expect(parseConfigurationOptions(content).PublicPort).toBe("49000");
  });
  it("classifies inherited, overridden, and invalid advertised ports", () => {
    expect(advertisedPortState(undefined, 8211)).toEqual({ mode: "inherit", effectivePort: 8211 });
    expect(advertisedPortState("8211", 8211)).toEqual({ mode: "inherit", effectivePort: 8211 });
    expect(advertisedPortState("49000", 8211)).toEqual({ mode: "override", effectivePort: 49000 });
    expect(advertisedPortState("not-a-port", 8211)).toEqual({ mode: "invalid", raw: "not-a-port", effectivePort: 8211 });
  });
  it("follows game-port changes only while the advertised port is inherited", () => {
    expect(managedPublicPortChange(advertisedPortState("8211", 8211), 8211, 9000, undefined, false)).toBe("9000");
    expect(managedPublicPortChange(advertisedPortState("49000", 8211), 8211, 9000, undefined, false)).toBeUndefined();
    expect(managedPublicPortChange(advertisedPortState("49000", 8211), 8211, 9000, null, true)).toBe("9000");
    expect(managedPublicPortChange(advertisedPortState("49000", 8211), 8211, 9000, 50000, true)).toBe("50000");
  });
  it("follows Server Name only while Display Name is inherited", () => {
    expect(managedDisplayNameChange("Old server", '"Old server"', '"New server"', undefined, false)).toBe("New server");
    expect(managedDisplayNameChange("PSM override", '"Old server"', '"New server"', undefined, false)).toBeUndefined();
    expect(managedDisplayNameChange("PSM override", '"Old server"', '"New server"', null, true)).toBe("New server");
    expect(managedDisplayNameChange("Old server", '"Old server"', '"New server"', "Local name", true)).toBe("Local name");
    expect(() => managedDisplayNameChange("PSM override", undefined, undefined, null, true)).toThrow("cannot inherit");
  });
  it("reconciles manager-integrated values from raw INI without touching presentation properties", () => {
    const content = '[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(AdminPassword="new",ServerPassword="players",RESTAPIEnabled=False,RESTAPIPort=9012,RCONEnabled=True,RCONPort=25580)\n';
    expect(managedWorldChangesFromConfiguration(content)).toEqual({ restApiEnabled: false, restApiPort: 9012, rconEnabled: true, rconPort: 25580 });
    expect(configurationCredentials(content)).toEqual({ adminPassword: "new", serverPassword: "players" });
  });
  it("places each guided field exactly once in the canonical tree", () => {
    const sections = PALWORLD_SETTING_TABS.flatMap((tab) => tab.sections);
    const keys = sections.flatMap((section) => section.fields.map((field) => field.key));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.filter((key) => (PALWORLD_MANAGER_SETTING_KEYS as readonly string[]).includes(key))).toEqual([]);
    const admin = PALWORLD_SETTING_TABS.find((tab) => tab.id === "server-admin");
    expect(admin?.sections.flatMap((section) => section.fields.map((field) => field.key))).toEqual(expect.arrayContaining(["ServerName", "BanListURL", "AutoSaveSpan", "ServerReplicatePawnCullDistance"]));
    expect(admin?.sections.slice(0, 3).map((section) => section.title)).toEqual(["Server Identity", "Community Listing", "Network & Ports"]);
    expect(PALWORLD_SETTING_FIELDS.filter((field) => field.presentation === "wide").map((field) => field.key)).toEqual(["CrossplayPlatforms", "ServerDescription", "BanListURL"]);
    expect(settingPresentation({ key: "Tuple", label: "Tuple", type: "tuple", help: "", evidence: "official" })).toBe("wide");
    expect(settingPresentation({ key: "Toggle", label: "Toggle", type: "bool", help: "", evidence: "official" })).toBe("compact");
    expect(settingLayoutSpan("standard")).toBe(6);
    const adminFieldKeys = new Set(admin?.sections.flatMap((section) => section.fields.map((field) => field.key)));
    const laidOutFieldKeys = admin?.sections.flatMap((section) => section.layout?.flatMap((item) => item.keys.filter((key) => adminFieldKeys.has(key))) ?? []) ?? [];
    expect(new Set(laidOutFieldKeys).size).toBe(laidOutFieldKeys.length);
    expect(new Set(laidOutFieldKeys)).toEqual(adminFieldKeys);
    const laidOutManagerKeys = admin?.sections.flatMap((section) => section.layout?.flatMap((item) => item.keys.filter((key) => !adminFieldKeys.has(key))) ?? []) ?? [];
    expect(new Set(laidOutManagerKeys)).toEqual(new Set(["displayName", "communityServer", "publicPort", "gamePort", "queryPort", "restApiEnabled", "restApiPort", "rconEnabled", "rconPort", "autostart", "crashGuard", "legacyPerfFlags", "platform", "installDir", "extraArgs", "environment", "wineBinary", "winePrefix", "wineLaunchFlags"]));
  });
  it("organizes every guided field exactly once across five presentation tabs", () => {
    const layoutKeys = PALWORLD_SETTING_TABS.flatMap((tab) => tab.sections.flatMap((section) => section.fields.map((field) => field.key)));
    expect(PALWORLD_SETTING_TABS.map((tab) => tab.title)).toEqual(["Gameplay", "Players & Pals", "World & Bases", "Multiplayer", "Server Admin"]);
    expect(layoutKeys).toHaveLength(PALWORLD_SETTING_FIELDS.length);
    expect(new Set(layoutKeys).size).toBe(layoutKeys.length);
    expect([...layoutKeys].sort()).toEqual(PALWORLD_SETTING_FIELDS.map((field) => field.key).sort());
    expect(PALWORLD_SETTING_TABS.flatMap((tab) => tab.sections).filter((section) => section.managed).map((section) => [section.title, section.managed])).toEqual([
      ["Server Identity", "identity"], ["Community Listing", "listing"], ["Network & Ports", "network"], ["Lifecycle & Recovery", "lifecycle"],
      ["Performance & Synchronization", "performance"], ["Installation & Launch", "launch"],
    ]);
  });
  it("exposes and validates the complete original structured field inventory", () => {
    expect(PALWORLD_SETTING_FIELDS).toHaveLength(117);
    expect(validateAndEncodeSettingChanges({ BaseCampWorkerMaxNum: 50, DeathPenalty: "Item", bEnableFastTravel: false })).toEqual({ BaseCampWorkerMaxNum: "50", DeathPenalty: "Item", bEnableFastTravel: "False" });
    expect(() => validateAndEncodeSettingChanges({ BaseCampWorkerMaxNum: 51 })).toThrow("cannot be higher than 50");
    expect(() => validateAndEncodeSettingChanges({ DeathPenalty: "Everything" })).toThrow("must be one of");
    expect(() => validateAndEncodeSettingChanges({ UnknownSetting: true })).toThrow("Unknown structured setting");
  });
  it("preserves invalid numeric tokens and distinguishes unsupported defaults", () => {
    const field = PALWORLD_SETTING_FIELDS.find((candidate) => candidate.key === "ServerReplicatePawnCullDistance")!;
    expect(decodeSettingValue(field, "NaN")).toMatchObject({ status: "invalid", raw: "NaN" });
    expect(decodeDefaultSettingValue(field, "NaN")).toMatchObject({ status: "unsupported-default", raw: "NaN" });
    expect(decodeSettingValue(field, "10000")).toEqual({ status: "valid", value: 10000, raw: "10000" });
  });
  it("round-trips DenyTechnologyList as an empty token or balanced tuple", () => {
    const field = PALWORLD_SETTING_FIELDS.find((candidate) => candidate.key === "DenyTechnologyList")!;
    expect(validateAndEncodeSettingChanges({ DenyTechnologyList: "" })).toEqual({ DenyTechnologyList: "" });
    const tuple = '("TechnologyA","TechnologyB")';
    expect(validateAndEncodeSettingChanges({ DenyTechnologyList: tuple })).toEqual({ DenyTechnologyList: tuple });
    expect(decodeSettingValue(field, tuple)).toEqual({ status: "valid", value: tuple, raw: tuple });
    expect(() => validateAndEncodeSettingChanges({ DenyTechnologyList: '("TechnologyA"' })).toThrow("balanced tuple");
  });
  it("owns CrossplayPlatforms tuple parsing and canonical serialization", () => {
    const field = PALWORLD_SETTING_FIELDS.find((candidate) => candidate.key === "CrossplayPlatforms")!;
    expect(field).toMatchObject({ type: "multi-select", options: ["Steam", "Xbox", "PS5", "Mac"], presentation: "wide" });
    expect(decodeSettingValue(field, "(PS5, Steam)")).toEqual({ status: "valid", value: ["Steam", "PS5"], raw: "(PS5, Steam)" });
    expect(validateAndEncodeSettingChanges({ CrossplayPlatforms: ["PS5", "Steam"] })).toEqual({ CrossplayPlatforms: "(Steam,PS5)" });
    expect(decodeSettingValue(field, "Steam,Xbox")).toMatchObject({ status: "invalid" });
    expect(decodeSettingValue(field, "(Steam,Switch)")).toMatchObject({ status: "invalid" });
    expect(decodeSettingValue(field, "(Steam,Steam)")).toMatchObject({ status: "invalid" });
    expect(() => validateAndEncodeSettingChanges({ CrossplayPlatforms: [] })).toThrow("one or more");
  });
  it("accounts for every setting in the tested Palworld 1.0.5 template", async () => {
    const template = await readFile(path.join(process.cwd(), "tests/fixtures/DefaultPalWorldSettings-1.0.5.ini"), "utf8");
    const provenance = JSON.parse(await readFile(path.join(process.cwd(), "tests/fixtures/DefaultPalWorldSettings-1.0.5.json"), "utf8")) as { sha256: string };
    expect(createHash("sha256").update(template).digest("hex"), "Update the reviewed template and provenance together").toBe(provenance.sha256);
    const templateKeys = Object.keys(parseConfigurationOptions(template)).sort();
    const representedKeys = [...PALWORLD_SETTING_FIELDS.map((field) => field.key), ...PALWORLD_MANAGER_SETTING_KEYS].sort();
    expect(templateKeys).toHaveLength(122);
    expect(representedKeys).toEqual(templateKeys);
    const options = parseConfigurationOptions(template);
    for (const field of PALWORLD_SETTING_FIELDS) expect(decodeDefaultSettingValue(field, options[field.key]), field.key).toMatchObject({ status: "valid" });
  });
});

describe("job cancellation", () => {
  setupTestDataDirectory("psm-jobs-test-");

  it("lists and counts operations by world or for the manager alone", async () => {
    const { jobHistoryCounts, listJobs, startJob } = await import("@/server/services/jobs");
    const { createWorld } = await import("@/server/services/worlds");
    const world = await createWorld({ displayName: "Scoped", installDir: path.join(process.env.PALWORLD_MANAGER_DATA_DIR!, "..", "scoped-world"), gamePort: 39411, queryPort: 39412, restApiPort: 39413, rconPort: 39414 });
    const settle = async (id: string) => { for (let attempt = 0; attempt < 100; attempt += 1) { const job = (await listJobs(500)).find((item) => item.id === id); if (job && job.state !== "running" && job.state !== "queued") return; await new Promise((resolve) => setTimeout(resolve, 10)); } };
    await settle(await startJob(world.id, "scope-world", async () => {}));
    await settle(await startJob(null, "mod-download", async () => {}));
    expect((await listJobs(500, { app: true })).every((job) => job.worldId === null)).toBe(true);
    expect((await listJobs(500, { app: true })).some((job) => job.kind === "mod-download")).toBe(true);
    expect((await listJobs(500, { worldId: world.id })).map((job) => job.kind)).toEqual(["scope-world"]);
    expect(jobHistoryCounts({ worldId: world.id }).total).toBe(1);
    expect(jobHistoryCounts({ app: true }).total).toBeGreaterThanOrEqual(1);
    expect(jobHistoryCounts().total).toBe(jobHistoryCounts({ app: true }).total + (await listJobs(500)).filter((job) => job.worldId !== null).length);
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
