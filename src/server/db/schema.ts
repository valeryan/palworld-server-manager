import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const worlds = sqliteTable("worlds", {
  id: text("id").primaryKey(), displayName: text("display_name").notNull(), installDir: text("install_dir").notNull(),
  platform: text("platform", { enum: ["linux", "windows"] }).notNull().default("linux"),
  gamePort: integer("game_port").notNull(), queryPort: integer("query_port").notNull(), restApiPort: integer("rest_api_port").notNull(), rconPort: integer("rcon_port").notNull(),
  adminPassword: text("admin_password").notNull().default(""), serverPassword: text("server_password").notNull().default(""),
  restApiEnabled: integer("rest_api_enabled", { mode: "boolean" }).notNull().default(true), rconEnabled: integer("rcon_enabled", { mode: "boolean" }).notNull().default(false),
  communityServer: integer("community_server", { mode: "boolean" }).notNull().default(false), autostart: integer("autostart", { mode: "boolean" }).notNull().default(false),
  crashGuard: integer("crash_guard", { mode: "boolean" }).notNull().default(true), legacyPerfFlags: integer("legacy_perf_flags", { mode: "boolean" }).notNull().default(true),
  extraArgs: text("extra_args").notNull().default(""), environment: text("environment", { mode: "json" }).$type<Record<string, string>>().notNull().default({}),
  wineBinary: text("wine_binary").notNull().default("wine"), winePrefix: text("wine_prefix"), wineLaunchFlags: text("wine_launch_flags").notNull().default(""),
  status: text("status", { enum: ["stopped", "starting", "running", "stopping", "crashed", "unknown"] }).notNull().default("stopped"),
  processId: integer("process_id"), buildId: text("build_id"), latestBuildId: text("latest_build_id"),
  lastStartedAt: integer("last_started_at"), crashCount: integer("crash_count").notNull().default(0), modsEnabled: integer("mods_enabled", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (table) => [uniqueIndex("worlds_install_dir_unique").on(table.installDir)]);

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(), worldId: text("world_id").references(() => worlds.id, { onDelete: "set null" }), kind: text("kind").notNull(),
  state: text("state", { enum: ["queued", "running", "succeeded", "failed", "cancelled"] }).notNull(), progress: integer("progress").notNull().default(0),
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
  action: text("action", { enum: ["backup", "restart", "stop", "update", "system_message", "onscreen_notice", "custom_http", "idle_stop"] }).notNull(),
  mode: text("mode", { enum: ["interval", "daily", "minutes", "on_join"] }).notNull(), intervalHours: integer("interval_hours"),
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

export const deaths = sqliteTable("deaths", {
  id: integer("id").primaryKey({ autoIncrement: true }), worldId: text("world_id").notNull().references(() => worlds.id, { onDelete: "cascade" }),
  victim: text("victim").notNull(), cause: text("cause"), killer: text("killer"), killerRaw: text("killer_raw"), killerKind: text("killer_kind"), createdAt: integer("created_at").notNull(),
}, (table) => [index("deaths_world_created_idx").on(table.worldId, table.createdAt)]);

export const mods = sqliteTable("mods", {
  id: text("id").primaryKey(), worldId: text("world_id").notNull().references(() => worlds.id, { onDelete: "cascade" }), packageName: text("package_name").notNull(),
  displayName: text("display_name"), workshopId: text("workshop_id"), version: text("version"), source: text("source"), folder: text("folder"),
  serverOnly: integer("server_only", { mode: "boolean" }).notNull().default(true), enabled: integer("enabled", { mode: "boolean" }).notNull().default(true), createdAt: integer("created_at").notNull(),
}, (table) => [index("mods_world_idx").on(table.worldId)]);

export const appSettings = sqliteTable("app_settings", { key: text("key").primaryKey(), value: text("value", { mode: "json" }).$type<unknown>() });

export const remoteAccessCodes = sqliteTable("remote_access_codes", {
  id: text("id").primaryKey(),
  codeHash: text("code_hash").notNull(),
  codeHint: text("code_hint").notNull(),
  label: text("label").notNull(),
  scope: text("scope", { enum: ["all", "world"] }).notNull(),
  worldId: text("world_id").references(() => worlds.id, { onDelete: "cascade" }),
  permissions: text("permissions", { mode: "json" }).$type<string[]>().notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull(),
  lastUsedAt: integer("last_used_at"),
}, (table) => [index("remote_codes_world_idx").on(table.worldId)]);

export const remoteSessions = sqliteTable("remote_sessions", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull(),
  codeId: text("code_id").notNull().references(() => remoteAccessCodes.id, { onDelete: "cascade" }),
  createdAt: integer("created_at").notNull(),
  lastSeenAt: integer("last_seen_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  revokedAt: integer("revoked_at"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
}, (table) => [uniqueIndex("remote_sessions_token_unique").on(table.tokenHash), index("remote_sessions_code_idx").on(table.codeId)]);

export const remoteAudit = sqliteTable("remote_audit", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  codeId: text("code_id").references(() => remoteAccessCodes.id, { onDelete: "set null" }),
  principalLabel: text("principal_label").notNull(),
  action: text("action").notNull(),
  worldId: text("world_id").references(() => worlds.id, { onDelete: "set null" }),
  detail: text("detail"),
  ipAddress: text("ip_address"),
  createdAt: integer("created_at").notNull(),
}, (table) => [index("remote_audit_created_idx").on(table.createdAt), index("remote_audit_code_idx").on(table.codeId)]);

export const legacyImports = sqliteTable("legacy_imports", {
  id: text("id").primaryKey(), sourcePath: text("source_path").notNull(), sourceHash: text("source_hash").notNull(),
  snapshot: text("snapshot", { mode: "json" }).$type<Record<string, unknown>>().notNull(), report: text("report", { mode: "json" }).$type<Record<string, unknown>>().notNull(), createdAt: integer("created_at").notNull(),
});
