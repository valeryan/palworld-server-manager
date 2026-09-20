CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY,
	`value` text
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
CREATE TABLE `legacy_imports` (
	`id` text PRIMARY KEY,
	`source_path` text NOT NULL,
	`source_hash` text NOT NULL,
	`snapshot` text NOT NULL,
	`report` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `schedules` (
	`id` text PRIMARY KEY,
	`world_id` text NOT NULL,
	`action` text NOT NULL,
	`mode` text NOT NULL,
	`interval_minutes` integer,
	`time_of_day` text,
	`message` text,
	`enabled` integer DEFAULT true NOT NULL,
	`skip_next` integer DEFAULT false NOT NULL,
	`last_run_at` integer,
	`next_run_at` integer,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_schedules_world_id_worlds_id_fk` FOREIGN KEY (`world_id`) REFERENCES `worlds`(`id`) ON DELETE CASCADE
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
	`process_id` integer,
	`build_id` text,
	`latest_build_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `backups_world_created_idx` ON `backups` (`world_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `config_versions_world_created_idx` ON `config_versions` (`world_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `events_world_created_idx` ON `events` (`world_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `jobs_world_created_idx` ON `jobs` (`world_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `worlds_install_dir_unique` ON `worlds` (`install_dir`);