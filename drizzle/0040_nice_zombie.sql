CREATE TABLE `restore_staging` (
	`id` text PRIMARY KEY NOT NULL,
	`upload` text NOT NULL,
	`user_id` text NOT NULL,
	`seq` integer NOT NULL,
	`section` text NOT NULL,
	`grouped` integer DEFAULT 0 NOT NULL,
	`row_count` integer NOT NULL,
	`bytes` integer NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `restore_staging_upload` ON `restore_staging` (`upload`,`seq`);--> statement-breakpoint
CREATE INDEX `restore_staging_created` ON `restore_staging` (`created_at`);