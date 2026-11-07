CREATE TABLE `coach_time_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`coach_email` text NOT NULL,
	`coach_name` text NOT NULL,
	`work_date` text NOT NULL,
	`session_key` text,
	`session_title` text,
	`session_start` text,
	`session_end` text,
	`duty` text NOT NULL,
	`source` text NOT NULL,
	`clock_in` text NOT NULL,
	`clock_out` text,
	`fixed_in` text,
	`fixed_out` text,
	`coach_note` text,
	`submitted_at` text,
	`owner_minutes` integer,
	`owner_duty` text,
	`owner_note` text,
	`approved_at` text,
	`approved_by` text,
	`approved_minutes` integer,
	`approved_duty` text,
	`approved_rate_cents` integer,
	`approved_cents` integer,
	`voided_at` text,
	`voided_by` text,
	`void_reason` text,
	`history` text DEFAULT '[]' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "coach_time_duty" CHECK("coach_time_entries"."duty" IN ('head','assistant') AND ("coach_time_entries"."owner_duty" IS NULL OR "coach_time_entries"."owner_duty" IN ('head','assistant')) AND ("coach_time_entries"."approved_duty" IS NULL OR "coach_time_entries"."approved_duty" IN ('head','assistant'))),
	CONSTRAINT "coach_time_source" CHECK("coach_time_entries"."source" IN ('clock','hand')),
	CONSTRAINT "coach_time_minutes" CHECK(("coach_time_entries"."owner_minutes" IS NULL OR "coach_time_entries"."owner_minutes" BETWEEN 0 AND 1440) AND ("coach_time_entries"."approved_minutes" IS NULL OR "coach_time_entries"."approved_minutes" BETWEEN 0 AND 1440) AND ("coach_time_entries"."approved_cents" IS NULL OR "coach_time_entries"."approved_cents" >= 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `coach_time_one_open` ON `coach_time_entries` (`coach_email`) WHERE "coach_time_entries"."clock_out" IS NULL AND "coach_time_entries"."voided_at" IS NULL;--> statement-breakpoint
CREATE INDEX `coach_time_month` ON `coach_time_entries` (`work_date`,`coach_email`);--> statement-breakpoint
CREATE TABLE `coach_time_off` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`coach_email` text NOT NULL,
	`coach_name` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`reason` text NOT NULL,
	`status` text NOT NULL,
	`programs` text DEFAULT '[]' NOT NULL,
	`requested_at` text NOT NULL,
	`decided_at` text,
	`decided_by` text,
	`decision_note` text,
	`revision` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "coach_time_off_status" CHECK("coach_time_off"."status" IN ('pending','approved','declined','withdrawn')),
	CONSTRAINT "coach_time_off_range" CHECK("coach_time_off"."start_date" <= "coach_time_off"."end_date")
);
--> statement-breakpoint
CREATE INDEX `coach_time_off_coach` ON `coach_time_off` (`coach_email`,`start_date`);--> statement-breakpoint
CREATE INDEX `coach_time_off_status` ON `coach_time_off` (`status`,`start_date`);