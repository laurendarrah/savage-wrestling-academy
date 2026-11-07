PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_booking_exceptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`wrestler_id` text NOT NULL,
	`rule` text NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text NOT NULL,
	`reason` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`revoked_at` text,
	`revoked_by` text,
	CONSTRAINT "booking_exception_rule" CHECK("__new_booking_exceptions"."rule" IN ('usaw','waiver','parent_consent'))
);
--> statement-breakpoint
INSERT INTO `__new_booking_exceptions`("id", "user_id", "wrestler_id", "rule", "starts_on", "ends_on", "reason", "created_by", "created_at", "revoked_at", "revoked_by") SELECT "id", "user_id", "wrestler_id", "rule", "starts_on", "ends_on", "reason", "created_by", "created_at", "revoked_at", "revoked_by" FROM `booking_exceptions`;--> statement-breakpoint
DROP TABLE `booking_exceptions`;--> statement-breakpoint
ALTER TABLE `__new_booking_exceptions` RENAME TO `booking_exceptions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `booking_exceptions_wrestler` ON `booking_exceptions` (`user_id`,`wrestler_id`,`rule`);--> statement-breakpoint
ALTER TABLE `waiver_versions` ADD `kind` text DEFAULT 'waiver' NOT NULL;--> statement-breakpoint
CREATE INDEX `waiver_versions_kind` ON `waiver_versions` (`kind`,`published_at`);