CREATE TABLE `attendance_checkins` (
	`practice_id` text NOT NULL,
	`date` text NOT NULL,
	`program` text NOT NULL,
	`practice_start` text NOT NULL,
	`practice_end` text NOT NULL,
	`user_id` text NOT NULL,
	`wrestler_id` text NOT NULL,
	`wrestler_name` text NOT NULL,
	`checked_at` text NOT NULL,
	`method` text NOT NULL,
	`checked_by` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_practice_wrestler` ON `attendance_checkins` (`practice_id`,`user_id`,`wrestler_id`);--> statement-breakpoint
CREATE INDEX `attendance_day` ON `attendance_checkins` (`date`);--> statement-breakpoint
CREATE TABLE `program_enrollments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`wrestler_id` text NOT NULL,
	`program` text NOT NULL,
	`kind` text NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text NOT NULL,
	`practice_start` text,
	`practice_end` text,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	`voided_at` text,
	CONSTRAINT "enrollment_kind" CHECK(("program_enrollments"."kind"='membership' AND "program_enrollments"."practice_start" IS NULL AND "program_enrollments"."practice_end" IS NULL) OR
  ("program_enrollments"."kind"='walkin' AND "program_enrollments"."starts_on"="program_enrollments"."ends_on" AND "program_enrollments"."practice_start" IS NOT NULL AND "program_enrollments"."practice_end" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `enrollment_roster` ON `program_enrollments` (`program`,`starts_on`,`ends_on`);--> statement-breakpoint
CREATE INDEX `enrollment_family` ON `program_enrollments` (`user_id`,`wrestler_id`);--> statement-breakpoint
CREATE TABLE `wrestler_passes` (
	`token` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`wrestler_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wrestler_pass_owner` ON `wrestler_passes` (`user_id`,`wrestler_id`);