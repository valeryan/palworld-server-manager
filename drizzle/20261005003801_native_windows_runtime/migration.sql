ALTER TABLE `world_settings` ADD `manager_applied_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `worlds` ADD `process_identity` text;--> statement-breakpoint
ALTER TABLE `worlds` ADD `argument_format` text DEFAULT 'legacy' NOT NULL;
--> statement-breakpoint
UPDATE world_settings SET manager_applied_revision = applied_revision;
