CREATE TABLE `remote_access_codes` (
	`id` text PRIMARY KEY,
	`code_hash` text NOT NULL,
	`code_hint` text NOT NULL,
	`label` text NOT NULL,
	`scope` text NOT NULL,
	`world_id` text,
	`permissions` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	CONSTRAINT `fk_remote_access_codes_world_id_worlds_id_fk` FOREIGN KEY (`world_id`) REFERENCES `worlds`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `remote_audit` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`code_id` text,
	`principal_label` text NOT NULL,
	`action` text NOT NULL,
	`world_id` text,
	`detail` text,
	`ip_address` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_remote_audit_code_id_remote_access_codes_id_fk` FOREIGN KEY (`code_id`) REFERENCES `remote_access_codes`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_remote_audit_world_id_worlds_id_fk` FOREIGN KEY (`world_id`) REFERENCES `worlds`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `remote_sessions` (
	`id` text PRIMARY KEY,
	`token_hash` text NOT NULL,
	`code_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`ip_address` text,
	`user_agent` text,
	CONSTRAINT `fk_remote_sessions_code_id_remote_access_codes_id_fk` FOREIGN KEY (`code_id`) REFERENCES `remote_access_codes`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `remote_codes_world_idx` ON `remote_access_codes` (`world_id`);--> statement-breakpoint
CREATE INDEX `remote_audit_created_idx` ON `remote_audit` (`created_at`);--> statement-breakpoint
CREATE INDEX `remote_audit_code_idx` ON `remote_audit` (`code_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `remote_sessions_token_unique` ON `remote_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `remote_sessions_code_idx` ON `remote_sessions` (`code_id`);