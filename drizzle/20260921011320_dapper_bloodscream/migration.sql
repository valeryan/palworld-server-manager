CREATE TABLE `backup_settings` (
	`world_id` text PRIMARY KEY,
	`destination_dir` text,
	`retention_count` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_backup_settings_world_id_worlds_id_fk` FOREIGN KEY (`world_id`) REFERENCES `worlds`(`id`) ON DELETE CASCADE
);
