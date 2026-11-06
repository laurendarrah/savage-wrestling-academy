CREATE TABLE `error_log` (
	`id` text PRIMARY KEY NOT NULL,
	`at` text NOT NULL,
	`method` text NOT NULL,
	`path` text NOT NULL,
	`status` integer NOT NULL,
	`message` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `error_log_at` ON `error_log` (`at`);