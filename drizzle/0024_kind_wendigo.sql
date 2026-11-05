CREATE TABLE `booking_exceptions` (
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
	CONSTRAINT "booking_exception_rule" CHECK("booking_exceptions"."rule" IN ('usaw','waiver'))
);
--> statement-breakpoint
CREATE INDEX `booking_exceptions_wrestler` ON `booking_exceptions` (`user_id`,`wrestler_id`,`rule`);