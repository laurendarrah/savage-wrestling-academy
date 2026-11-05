DROP INDEX `waiver_signature_once`;--> statement-breakpoint
CREATE UNIQUE INDEX `waiver_signature_per_child` ON `waiver_signatures` (`version_id`,`user_id`,`wrestler_id`,`wrestler_name`);