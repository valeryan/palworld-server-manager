CREATE TABLE `world_settings` (
	`world_id` text PRIMARY KEY,
	`desired_manager` text NOT NULL,
	`desired_content` text NOT NULL,
	`applied_content` text NOT NULL,
	`desired_revision` integer DEFAULT 1 NOT NULL,
	`applied_revision` integer DEFAULT 0 NOT NULL,
	`applied_semantic_hash` text,
	`pending_since` integer,
	`last_apply_error` text,
	`drift` integer DEFAULT false NOT NULL,
	`drift_reason` text,
	`updated_at` integer NOT NULL,
	`applied_at` integer,
	CONSTRAINT `fk_world_settings_world_id_worlds_id_fk` FOREIGN KEY (`world_id`) REFERENCES `worlds`(`id`) ON DELETE CASCADE
);
