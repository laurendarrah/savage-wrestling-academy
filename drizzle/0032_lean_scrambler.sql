CREATE TABLE `coach_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`programs` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`used_by` text,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `coach_invites_token` ON `coach_invites` (`token_hash`);--> statement-breakpoint
CREATE INDEX `coach_invites_email` ON `coach_invites` (`email`);--> statement-breakpoint
CREATE TABLE `coach_profiles` (
	`email` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`bio` text NOT NULL,
	`specialties` text NOT NULL,
	`phone` text NOT NULL,
	`photo_key` text,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL
);
