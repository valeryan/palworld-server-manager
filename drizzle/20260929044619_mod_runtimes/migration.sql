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
