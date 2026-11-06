CREATE TABLE `coach_lesson_rates` (
	`email` text PRIMARY KEY NOT NULL,
	`rate_cents` integer,
	CONSTRAINT "coach_lesson_rate_cents" CHECK("coach_lesson_rates"."rate_cents" BETWEEN 1 AND 100000)
);
--> statement-breakpoint
CREATE TABLE `__new_coach_time_entries` (
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
	`draft_seconds` integer,
	`draft_duty` text,
	`draft_note` text,
	`submitted_at` text,
	`review_note` text,
	`approved_at` text,
	`approved_by` text,
	`voided_at` text,
	`revision` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "coach_time_duty" CHECK("__new_coach_time_entries"."duty" IN ('head','assistant','private_lesson')),
	CONSTRAINT "coach_time_approved_duty" CHECK("__new_coach_time_entries"."approved_duty" IN ('head','assistant','private_lesson')),
	CONSTRAINT "coach_time_approved_seconds" CHECK("__new_coach_time_entries"."approved_seconds" BETWEEN 1 AND 86400)
);
--> statement-breakpoint
INSERT INTO `__new_coach_time_entries`("id", "user_id", "coach_name", "coach_email", "program", "duty", "work_date", "started_at", "ended_at", "closed_at", "approved_seconds", "approved_duty", "approved_rate_cents", "rate_cents", "draft_seconds", "draft_duty", "draft_note", "submitted_at", "review_note", "approved_at", "approved_by", "voided_at", "revision") SELECT "id", "user_id", "coach_name", "coach_email", "program", "duty", "work_date", "started_at", "ended_at", "closed_at", "approved_seconds", "approved_duty", "approved_rate_cents", "rate_cents", "draft_seconds", "draft_duty", "draft_note", "submitted_at", "review_note", "approved_at", "approved_by", "voided_at", "revision" FROM `coach_time_entries`;--> statement-breakpoint
DROP TABLE `coach_time_entries`;--> statement-breakpoint
ALTER TABLE `__new_coach_time_entries` RENAME TO `coach_time_entries`;--> statement-breakpoint
CREATE UNIQUE INDEX `coach_one_open_shift` ON `coach_time_entries` (`user_id`) WHERE "coach_time_entries"."closed_at" IS NULL;--> statement-breakpoint
CREATE INDEX `coach_time_period` ON `coach_time_entries` (`work_date`,`id`);--> statement-breakpoint
CREATE INDEX `coach_time_by_user` ON `coach_time_entries` (`user_id`,`work_date`,`id`);