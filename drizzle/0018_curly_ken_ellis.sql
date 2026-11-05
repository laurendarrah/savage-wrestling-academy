CREATE TABLE `waiver_signatures` (
	`id` text PRIMARY KEY NOT NULL,
	`version_id` text NOT NULL,
	`user_id` text NOT NULL,
	`wrestler_id` text NOT NULL,
	`wrestler_name` text NOT NULL,
	`signer` text NOT NULL,
	`email` text NOT NULL,
	`signature_record` text NOT NULL,
	`signed_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `waiver_signature_once` ON `waiver_signatures` (`version_id`,`user_id`,`wrestler_id`);--> statement-breakpoint
CREATE INDEX `waiver_signatures_family` ON `waiver_signatures` (`user_id`,`wrestler_id`);--> statement-breakpoint
CREATE TABLE `waiver_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`sha256` text NOT NULL,
	`published_at` text NOT NULL,
	`published_by` text NOT NULL,
	`retired_at` text
);
--> statement-breakpoint
CREATE INDEX `waiver_versions_published` ON `waiver_versions` (`published_at`);