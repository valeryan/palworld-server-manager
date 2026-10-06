DROP INDEX IF EXISTS `mods_world_idx`;--> statement-breakpoint
DROP TABLE `mods`;--> statement-breakpoint
ALTER TABLE `worlds` DROP COLUMN `mods_enabled`;