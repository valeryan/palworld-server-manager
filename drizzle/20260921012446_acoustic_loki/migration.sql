CREATE TABLE `maintenance_settings` (
	`world_id` text PRIMARY KEY,
	`warning_enabled` integer DEFAULT false NOT NULL,
	`warning_lead_minutes` integer DEFAULT 10 NOT NULL,
	`warning_interval_minutes` integer DEFAULT 2 NOT NULL,
	`warning_message` text DEFAULT 'The server will {action} in {minutes} minute(s). Please get to a safe place.' NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_maintenance_settings_world_id_worlds_id_fk` FOREIGN KEY (`world_id`) REFERENCES `worlds`(`id`) ON DELETE CASCADE
);
