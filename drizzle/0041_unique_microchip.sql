CREATE TABLE `signature_reissues` (
	`signature_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`reason` text NOT NULL,
	`reissued_by` text NOT NULL,
	`reissued_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `signature_reissues_user` ON `signature_reissues` (`user_id`);--> statement-breakpoint
DROP INDEX `waiver_signature_per_child`;--> statement-breakpoint
ALTER TABLE `waiver_signatures` ADD `round` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `waiver_signature_per_round` ON `waiver_signatures` (`version_id`,`user_id`,`wrestler_id`,`wrestler_name`,`round`);