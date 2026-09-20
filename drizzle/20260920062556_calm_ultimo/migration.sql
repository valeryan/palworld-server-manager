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
CREATE TABLE `mods` (
	`id` text PRIMARY KEY,
	`world_id` text NOT NULL,
	`package_name` text NOT NULL,
	`display_name` text,
	`workshop_id` text,
	`version` text,
	`source` text,
	`folder` text,
	`server_only` integer DEFAULT true NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_mods_world_id_worlds_id_fk` FOREIGN KEY (`world_id`) REFERENCES `worlds`(`id`) ON DELETE CASCADE
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
ALTER TABLE `schedules` ADD `interval_hours` integer;--> statement-breakpoint
ALTER TABLE `schedules` ADD `join_match` text;--> statement-breakpoint
ALTER TABLE `schedules` ADD `join_delay_seconds` integer;--> statement-breakpoint
ALTER TABLE `worlds` ADD `last_started_at` integer;--> statement-breakpoint
ALTER TABLE `worlds` ADD `crash_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `worlds` ADD `mods_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `deaths_world_created_idx` ON `deaths` (`world_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `mods_world_idx` ON `mods` (`world_id`);--> statement-breakpoint
CREATE INDEX `sessions_world_created_idx` ON `sessions` (`world_id`,`created_at`);