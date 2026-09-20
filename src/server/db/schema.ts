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
  processId: integer("process_id"), buildId: text("build_id"), latestBuildId: text("latest_build_id"), createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (table) => [uniqueIndex("worlds_install_dir_unique").on(table.installDir)]);

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(), worldId: text("world_id").references(() => worlds.id, { onDelete: "set null" }), kind: text("kind").notNull(),
  state: text("state", { enum: ["queued", "running", "succeeded", "failed", "cancelled"] }).notNull(), progress: integer("progress").notNull().default(0),
  message: text("message").notNull().default(""), error: text("error"), createdAt: integer("created_at").notNull(), startedAt: integer("started_at"), finishedAt: integer("finished_at"),
}, (table) => [index("jobs_world_created_idx").on(table.worldId, table.createdAt)]);

export const events = sqliteTable("events", {
  id: integer("id").primaryKey({ autoIncrement: true }), worldId: text("world_id").references(() => worlds.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), message: text("message").notNull(), metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown> | null>(), createdAt: integer("created_at").notNull(),
}, (table) => [index("events_world_created_idx").on(table.worldId, table.createdAt)]);

export const backups = sqliteTable("backups", {
  id: text("id").primaryKey(), worldId: text("world_id").notNull().references(() => worlds.id, { onDelete: "cascade" }), filePath: text("file_path").notNull(),
  sizeBytes: integer("size_bytes").notNull(), reason: text("reason").notNull(), verified: integer("verified", { mode: "boolean" }).notNull().default(false), createdAt: integer("created_at").notNull(),
}, (table) => [index("backups_world_created_idx").on(table.worldId, table.createdAt)]);

export const schedules = sqliteTable("schedules", {
  id: text("id").primaryKey(), worldId: text("world_id").notNull().references(() => worlds.id, { onDelete: "cascade" }),
  action: text("action", { enum: ["backup", "restart", "update", "message"] }).notNull(), mode: text("mode", { enum: ["interval", "daily"] }).notNull(),
  intervalMinutes: integer("interval_minutes"), timeOfDay: text("time_of_day"), message: text("message"), enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  skipNext: integer("skip_next", { mode: "boolean" }).notNull().default(false), lastRunAt: integer("last_run_at"), nextRunAt: integer("next_run_at"), createdAt: integer("created_at").notNull(),
});

export const configVersions = sqliteTable("config_versions", {
  id: text("id").primaryKey(), worldId: text("world_id").notNull().references(() => worlds.id, { onDelete: "cascade" }), fileName: text("file_name").notNull(),
  content: text("content").notNull(), note: text("note"), createdAt: integer("created_at").notNull(),
}, (table) => [index("config_versions_world_created_idx").on(table.worldId, table.createdAt)]);

export const appSettings = sqliteTable("app_settings", { key: text("key").primaryKey(), value: text("value", { mode: "json" }).$type<unknown>() });
export const legacyImports = sqliteTable("legacy_imports", {
  id: text("id").primaryKey(), sourcePath: text("source_path").notNull(), sourceHash: text("source_hash").notNull(),
  snapshot: text("snapshot", { mode: "json" }).$type<Record<string, unknown>>().notNull(), report: text("report", { mode: "json" }).$type<Record<string, unknown>>().notNull(), createdAt: integer("created_at").notNull(),
});
