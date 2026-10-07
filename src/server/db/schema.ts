import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { JOB_STATES } from "@/contracts/job";
import { SCHEDULE_ACTIONS, SCHEDULE_MODES } from "@/contracts/schedule";
import { ARGUMENT_FORMATS, PLATFORMS, WORLD_STATUSES } from "@/contracts/world";

// Enumerations are shared with the contracts; SQLite stores plain text, so changing them here
// never changes the migration SQL.
export const worlds = sqliteTable("worlds", {
  id: text("id").primaryKey(), displayName: text("display_name").notNull(), installDir: text("install_dir").notNull(),
  platform: text("platform", { enum: PLATFORMS }).notNull().default("linux"),
  gamePort: integer("game_port").notNull(), queryPort: integer("query_port").notNull(), restApiPort: integer("rest_api_port").notNull(), rconPort: integer("rcon_port").notNull(),
  adminPassword: text("admin_password").notNull().default(""), serverPassword: text("server_password").notNull().default(""),
  restApiEnabled: integer("rest_api_enabled", { mode: "boolean" }).notNull().default(true), rconEnabled: integer("rcon_enabled", { mode: "boolean" }).notNull().default(false),
  communityServer: integer("community_server", { mode: "boolean" }).notNull().default(false), autostart: integer("autostart", { mode: "boolean" }).notNull().default(false),
  crashGuard: integer("crash_guard", { mode: "boolean" }).notNull().default(true), legacyPerfFlags: integer("legacy_perf_flags", { mode: "boolean" }).notNull().default(true),
  extraArgs: text("extra_args").notNull().default(""), environment: text("environment", { mode: "json" }).$type<Record<string, string>>().notNull().default({}),
  wineBinary: text("wine_binary").notNull().default("wine"), winePrefix: text("wine_prefix"), wineLaunchFlags: text("wine_launch_flags").notNull().default(""),
  status: text("status", { enum: WORLD_STATUSES }).notNull().default("stopped"),
  processIdentity: text("process_identity", { mode: "json" }).$type<import("@/server/services/process-inspection").ProcessIdentity[]>(),
  argumentFormat: text("argument_format", { enum: ARGUMENT_FORMATS }).notNull().default("legacy"),
  processId: integer("process_id"), buildId: text("build_id"), latestBuildId: text("latest_build_id"),
  lastStartedAt: integer("last_started_at"), crashCount: integer("crash_count").notNull().default(0),
  createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (table) => [uniqueIndex("worlds_install_dir_unique").on(table.installDir)]);

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(), worldId: text("world_id").references(() => worlds.id, { onDelete: "set null" }), kind: text("kind").notNull(),
  state: text("state", { enum: JOB_STATES }).notNull(), progress: integer("progress").notNull().default(0),
  message: text("message").notNull().default(""), error: text("error"), createdAt: integer("created_at").notNull(), startedAt: integer("started_at"), finishedAt: integer("finished_at"),
}, (table) => [index("jobs_world_created_idx").on(table.worldId, table.createdAt)]);

export const jobLogs = sqliteTable("job_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }), jobId: text("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  message: text("message").notNull(), createdAt: integer("created_at").notNull(),
}, (table) => [index("job_logs_job_created_idx").on(table.jobId, table.createdAt)]);

export const events = sqliteTable("events", {
  id: integer("id").primaryKey({ autoIncrement: true }), worldId: text("world_id").references(() => worlds.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), message: text("message").notNull(), metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown> | null>(), createdAt: integer("created_at").notNull(),
}, (table) => [index("events_world_created_idx").on(table.worldId, table.createdAt)]);

export const backups = sqliteTable("backups", {
  id: text("id").primaryKey(), worldId: text("world_id").notNull().references(() => worlds.id, { onDelete: "cascade" }), filePath: text("file_path").notNull(),
  sizeBytes: integer("size_bytes").notNull(), reason: text("reason").notNull(), verified: integer("verified", { mode: "boolean" }).notNull().default(false), createdAt: integer("created_at").notNull(),
}, (table) => [index("backups_world_created_idx").on(table.worldId, table.createdAt)]);

export const backupSettings = sqliteTable("backup_settings", {
  worldId: text("world_id").primaryKey().references(() => worlds.id, { onDelete: "cascade" }),
  destinationDir: text("destination_dir"),
  retentionCount: integer("retention_count").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
});

export const schedules = sqliteTable("schedules", {
  id: text("id").primaryKey(), worldId: text("world_id").notNull().references(() => worlds.id, { onDelete: "cascade" }),
  action: text("action", { enum: SCHEDULE_ACTIONS }).notNull(),
  mode: text("mode", { enum: SCHEDULE_MODES }).notNull(), intervalHours: integer("interval_hours"),
  intervalMinutes: integer("interval_minutes"), timeOfDay: text("time_of_day"), message: text("message"), joinMatch: text("join_match"), joinDelaySeconds: integer("join_delay_seconds"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  skipNext: integer("skip_next", { mode: "boolean" }).notNull().default(false), lastRunAt: integer("last_run_at"), nextRunAt: integer("next_run_at"), createdAt: integer("created_at").notNull(),
});

export const maintenanceSettings = sqliteTable("maintenance_settings", {
  worldId: text("world_id").primaryKey().references(() => worlds.id, { onDelete: "cascade" }),
  warningEnabled: integer("warning_enabled", { mode: "boolean" }).notNull().default(false),
  warningLeadMinutes: integer("warning_lead_minutes").notNull().default(10),
  warningIntervalMinutes: integer("warning_interval_minutes").notNull().default(2),
  warningMessage: text("warning_message").notNull().default("The server will {action} in {minutes} minute(s). Please get to a safe place."),
  updatedAt: integer("updated_at").notNull(),
});

export const configVersions = sqliteTable("config_versions", {
  id: text("id").primaryKey(), worldId: text("world_id").notNull().references(() => worlds.id, { onDelete: "cascade" }), fileName: text("file_name").notNull(),
  content: text("content").notNull(), note: text("note"), createdAt: integer("created_at").notNull(),
}, (table) => [index("config_versions_world_created_idx").on(table.worldId, table.createdAt)]);

export const worldSettings = sqliteTable("world_settings", {
  worldId: text("world_id").primaryKey().references(() => worlds.id, { onDelete: "cascade" }),
  desiredManager: text("desired_manager", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  desiredContent: text("desired_content").notNull(),
  appliedContent: text("applied_content").notNull(),
  desiredRevision: integer("desired_revision").notNull().default(1),
  appliedRevision: integer("applied_revision").notNull().default(0),
  managerAppliedRevision: integer("manager_applied_revision").notNull().default(0),
  appliedSemanticHash: text("applied_semantic_hash"),
  pendingSince: integer("pending_since"),
  lastApplyError: text("last_apply_error"),
  drift: integer("drift", { mode: "boolean" }).notNull().default(false),
  driftReason: text("drift_reason"),
  updatedAt: integer("updated_at").notNull(),
  appliedAt: integer("applied_at"),
});

export const sessions = sqliteTable("sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }), worldId: text("world_id").notNull().references(() => worlds.id, { onDelete: "cascade" }),
  userId: text("user_id"), playerName: text("player_name"), event: text("event", { enum: ["join", "leave"] }).notNull(), createdAt: integer("created_at").notNull(),
}, (table) => [index("sessions_world_created_idx").on(table.worldId, table.createdAt)]);

// Every player the presence poller has seen in a world, kept across activity retention so
// moderation can target a player who is offline.
export const worldPlayers = sqliteTable("world_players", {
  worldId: text("world_id").notNull().references(() => worlds.id, { onDelete: "cascade" }), userId: text("user_id").notNull(),
  playerName: text("player_name").notNull(), accountName: text("account_name"),
  firstSeenAt: integer("first_seen_at").notNull(), lastSeenAt: integer("last_seen_at").notNull(), lastLeftAt: integer("last_left_at"),
  joinCount: integer("join_count").notNull().default(1), bannedAt: integer("banned_at"),
}, (table) => [primaryKey({ columns: [table.worldId, table.userId] }), index("world_players_world_seen_idx").on(table.worldId, table.lastSeenAt)]);

export const deaths = sqliteTable("deaths", {
  id: integer("id").primaryKey({ autoIncrement: true }), worldId: text("world_id").notNull().references(() => worlds.id, { onDelete: "cascade" }),
  victim: text("victim").notNull(), cause: text("cause"), killer: text("killer"), killerRaw: text("killer_raw"), killerKind: text("killer_kind"), createdAt: integer("created_at").notNull(),
}, (table) => [index("deaths_world_created_idx").on(table.worldId, table.createdAt)]);

// Lua mod archives the user imported into the Mods library. One row per mod name; importing the
// same mod again replaces the library copy, and worlds see an update.
export const modArtifacts = sqliteTable("mod_artifacts", {
  id: text("id").primaryKey(), kind: text("kind", { enum: ["lua"] }).notNull(), name: text("name").notNull(),
  fileName: text("file_name").notNull(), sha256: text("sha256").notNull(), sizeBytes: integer("size_bytes").notNull(),
  addedAt: integer("added_at").notNull(),
}, (table) => [uniqueIndex("mod_artifacts_kind_name_unique").on(table.kind, table.name)]);

// UE4SS installed into a world by the manager. installedFiles (paths relative to the install
// directory) limits removal and repair to files the manager wrote.
export const modRuntimes = sqliteTable("mod_runtimes", {
  worldId: text("world_id").primaryKey().references(() => worlds.id, { onDelete: "cascade" }),
  artifactId: text("artifact_id").notNull(), variant: text("variant", { enum: PLATFORMS }).notNull(), version: text("version").notNull(), sha256: text("sha256").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  installedFiles: text("installed_files", { mode: "json" }).$type<string[]>().notNull(),
  earlyCrashes: integer("early_crashes").notNull().default(0), recoveryPaused: integer("recovery_paused", { mode: "boolean" }).notNull().default(false),
  installedAt: integer("installed_at").notNull(), updatedAt: integer("updated_at").notNull(),
});

export const appSettings = sqliteTable("app_settings", { key: text("key").primaryKey(), value: text("value", { mode: "json" }).$type<unknown>() });
