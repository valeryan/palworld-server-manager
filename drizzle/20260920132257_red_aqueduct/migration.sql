CREATE TABLE `job_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`job_id` text NOT NULL,
	`message` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_job_logs_job_id_jobs_id_fk` FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `job_logs_job_created_idx` ON `job_logs` (`job_id`,`created_at`);