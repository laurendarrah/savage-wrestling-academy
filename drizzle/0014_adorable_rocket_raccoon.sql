CREATE TABLE `attendance` (
	`id` text PRIMARY KEY NOT NULL,
	`session_key` text NOT NULL,
	`session_date` text NOT NULL,
	`user_id` text NOT NULL,
	`wrestler_id` text NOT NULL,
	`wrestler_name` text NOT NULL,
	`source` text NOT NULL,
	`checked_in_at` text NOT NULL,
	`checked_in_by` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_once` ON `attendance` (`session_key`,`user_id`,`wrestler_id`);--> statement-breakpoint
CREATE INDEX `attendance_date` ON `attendance` (`session_date`);