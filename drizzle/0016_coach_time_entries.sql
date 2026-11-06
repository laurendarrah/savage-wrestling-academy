CREATE TABLE `coach_time_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`coach_name` text NOT NULL,
	`coach_email` text NOT NULL,
	`program` text NOT NULL,
	`duty` text NOT NULL,
	`work_date` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`closed_at` text,
	`approved_seconds` integer,
	`approved_duty` text,
	`approved_rate_cents` integer,
	`rate_cents` integer NOT NULL,
	`review_note` text,
	`approved_at` text,
	`approved_by` text,
	`revision` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "coach_time_duty" CHECK("coach_time_entries"."duty" IN ('head','assistant')),
	CONSTRAINT "coach_time_approved_duty" CHECK("coach_time_entries"."approved_duty" IN ('head','assistant')),
	CONSTRAINT "coach_time_approved_seconds" CHECK("coach_time_entries"."approved_seconds" BETWEEN 1 AND 86400)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `coach_one_open_shift` ON `coach_time_entries` (`user_id`) WHERE "coach_time_entries"."closed_at" IS NULL;--> statement-breakpoint
CREATE INDEX `coach_time_period` ON `coach_time_entries` (`work_date`,`id`);--> statement-breakpoint
CREATE INDEX `coach_time_by_user` ON `coach_time_entries` (`user_id`,`work_date`,`id`);