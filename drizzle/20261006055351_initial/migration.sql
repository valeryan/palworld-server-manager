CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY,
	`value` text
);
--> statement-breakpoint
CREATE TABLE `backup_settings` (
	`world_id` text PRIMARY KEY,
	`destination_dir` text,
	`retention_count` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_backup_settings_world_id_worlds_id_fk` FOREIGN KEY (`world_id`) REFERENCES `worlds`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `backups` (
	`id` text PRIMARY KEY,
	`world_id` text NOT NULL,
	`file_path` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`reason` text NOT NULL,
	`verified` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_backups_world_id_worlds_id_fk` FOREIGN KEY (`world_id`) REFERENCES `worlds`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `config_versions` (
	`id` text PRIMARY KEY,
	`world_id` text NOT NULL,
	`file_name` text NOT NULL,
	`content` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_config_versions_world_id_worlds_id_fk` FOREIGN KEY (`world_id`) REFERENCES `worlds`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `deaths` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`world_id` text NOT NULL,
	`victim` text NOT NULL,
	`cause` text,
	`killer` text,
	`killer_raw` text,
	`killer_kind` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_deaths_world_id_worlds_id_fk` FOREIGN KEY (`world_id`) REFERENCES `worlds`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`world_id` text,
	`kind` text NOT NULL,
	`message` text NOT NULL,
	`metadata` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_events_world_id_worlds_id_fk` FOREIGN KEY (`world_id`) REFERENCES `worlds`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `job_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`job_id` text NOT NULL,
	`message` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_job_logs_job_id_jobs_id_fk` FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY,
	`world_id` text,
	`kind` text NOT NULL,
	`state` text NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	CONSTRAINT `fk_jobs_world_id_worlds_id_fk` FOREIGN KEY (`world_id`) REFERENCES `worlds`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `maintenance_settings` (
	`world_id` text PRIMARY KEY,
	`warning_enabled` integer DEFAULT false NOT NULL,
	`warning_lead_minutes` integer DEFAULT 10 NOT NULL,
	`warning_interval_minutes` integer DEFAULT 2 NOT NULL,
	`warning_message` text DEFAULT 'The server will {action} in {minutes} minute(s). Please get to a safe place.' NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_maintenance_settings_world_id_worlds_id_fk` FOREIGN KEY (`world_id`) REFERENCES `worlds`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `mod_artifacts` (
	`id` text PRIMARY KEY,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`file_name` text NOT NULL,
	`sha256` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`added_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mod_runtimes` (
	`world_id` text PRIMARY KEY,
	`artifact_id` text NOT NULL,
	`variant` text NOT NULL,
	`version` text NOT NULL,
	`sha256` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`installed_files` text NOT NULL,
	`early_crashes` integer DEFAULT 0 NOT NULL,
	`recovery_paused` integer DEFAULT false NOT NULL,
	`installed_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_mod_runtimes_world_id_worlds_id_fk` FOREIGN KEY (`world_id`) REFERENCES `worlds`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `schedules` (
	`id` text PRIMARY KEY,
	`world_id` text NOT NULL,
	`action` text NOT NULL,
	`mode` text NOT NULL,
	`interval_hours` integer,
	`interval_minutes` integer,
	`time_of_day` text,
	`message` text,
	`join_match` text,
	`join_delay_seconds` integer,
	`enabled` integer DEFAULT true NOT NULL,
	`skip_next` integer DEFAULT false NOT NULL,
	`last_run_at` integer,
	`next_run_at` integer,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_schedules_world_id_worlds_id_fk` FOREIGN KEY (`world_id`) REFERENCES `worlds`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`world_id` text NOT NULL,
	`user_id` text,
	`player_name` text,
	`event` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_sessions_world_id_worlds_id_fk` FOREIGN KEY (`world_id`) REFERENCES `worlds`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `world_players` (
	`world_id` text NOT NULL,
	`user_id` text NOT NULL,
	`player_name` text NOT NULL,
	`account_name` text,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`last_left_at` integer,
	`join_count` integer DEFAULT 1 NOT NULL,
	`banned_at` integer,
	CONSTRAINT `world_players_pk` PRIMARY KEY(`world_id`, `user_id`),
	CONSTRAINT `fk_world_players_world_id_worlds_id_fk` FOREIGN KEY (`world_id`) REFERENCES `worlds`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `world_settings` (
	`world_id` text PRIMARY KEY,
	`desired_manager` text NOT NULL,
	`desired_content` text NOT NULL,
	`applied_content` text NOT NULL,
	`desired_revision` integer DEFAULT 1 NOT NULL,
	`applied_revision` integer DEFAULT 0 NOT NULL,
	`manager_applied_revision` integer DEFAULT 0 NOT NULL,
	`applied_semantic_hash` text,
	`pending_since` integer,
	`last_apply_error` text,
	`drift` integer DEFAULT false NOT NULL,
	`drift_reason` text,
	`updated_at` integer NOT NULL,
	`applied_at` integer,
	CONSTRAINT `fk_world_settings_world_id_worlds_id_fk` FOREIGN KEY (`world_id`) REFERENCES `worlds`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `worlds` (
	`id` text PRIMARY KEY,
	`display_name` text NOT NULL,
	`install_dir` text NOT NULL,
	`platform` text DEFAULT 'linux' NOT NULL,
	`game_port` integer NOT NULL,
	`query_port` integer NOT NULL,
	`rest_api_port` integer NOT NULL,
	`rcon_port` integer NOT NULL,
	`admin_password` text DEFAULT '' NOT NULL,
	`server_password` text DEFAULT '' NOT NULL,
	`rest_api_enabled` integer DEFAULT true NOT NULL,
	`rcon_enabled` integer DEFAULT false NOT NULL,
	`community_server` integer DEFAULT false NOT NULL,
	`autostart` integer DEFAULT false NOT NULL,
	`crash_guard` integer DEFAULT true NOT NULL,
	`legacy_perf_flags` integer DEFAULT true NOT NULL,
	`extra_args` text DEFAULT '' NOT NULL,
	`environment` text DEFAULT '{}' NOT NULL,
	`wine_binary` text DEFAULT 'wine' NOT NULL,
	`wine_prefix` text,
	`wine_launch_flags` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'stopped' NOT NULL,
	`process_identity` text,
	`argument_format` text DEFAULT 'legacy' NOT NULL,
	`process_id` integer,
	`build_id` text,
	`latest_build_id` text,
	`last_started_at` integer,
	`crash_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `backups_world_created_idx` ON `backups` (`world_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `config_versions_world_created_idx` ON `config_versions` (`world_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `deaths_world_created_idx` ON `deaths` (`world_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `events_world_created_idx` ON `events` (`world_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `job_logs_job_created_idx` ON `job_logs` (`job_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `jobs_world_created_idx` ON `jobs` (`world_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `mod_artifacts_kind_name_unique` ON `mod_artifacts` (`kind`,`name`);--> statement-breakpoint
CREATE INDEX `sessions_world_created_idx` ON `sessions` (`world_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `world_players_world_seen_idx` ON `world_players` (`world_id`,`last_seen_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `worlds_install_dir_unique` ON `worlds` (`install_dir`);