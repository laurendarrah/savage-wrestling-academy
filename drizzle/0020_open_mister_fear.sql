CREATE TABLE `wrestler_passes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`wrestler_id` text NOT NULL,
	`token` text NOT NULL,
	`created_at` text NOT NULL,
	`revoked_at` text,
	`revoked_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wrestler_pass_token` ON `wrestler_passes` (`token`);--> statement-breakpoint
CREATE UNIQUE INDEX `wrestler_pass_active` ON `wrestler_passes` (`user_id`,`wrestler_id`) WHERE "wrestler_passes"."revoked_at" IS NULL;