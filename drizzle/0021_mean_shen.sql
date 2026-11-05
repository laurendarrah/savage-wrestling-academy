CREATE TABLE `waitlist_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`option` text NOT NULL,
	`dates` text NOT NULL,
	`user_id` text NOT NULL,
	`wrestler_id` text NOT NULL,
	`wrestler_name` text NOT NULL,
	`email` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`offered_at` text,
	`offer_expires_at` text,
	`offer_hours` integer,
	`auto_next` integer DEFAULT 0 NOT NULL,
	`offered_by` text,
	`closed_at` text,
	CONSTRAINT "waitlist_status" CHECK("waitlist_entries"."status" IN ('waiting','offered','accepted','expired','withdrawn','removed'))
);
--> statement-breakpoint
CREATE INDEX `waitlist_event` ON `waitlist_entries` (`event_id`,`status`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `waitlist_once` ON `waitlist_entries` (`event_id`,`user_id`,`wrestler_id`) WHERE "waitlist_entries"."status" IN ('waiting','offered');