CREATE TABLE `practice_plan_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`program` text NOT NULL,
	`date` text NOT NULL,
	`coach_id` text NOT NULL,
	`coach_name` text NOT NULL,
	`payload` text NOT NULL,
	`status` text NOT NULL,
	`revision` integer NOT NULL,
	`updated_at` text NOT NULL,
	`publish_token` text,
	CONSTRAINT "practice_plan_submission_status" CHECK("practice_plan_submissions"."status" IN ('draft','submitted','published'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `practice_plan_submission_coach_session` ON `practice_plan_submissions` (`coach_id`,`program`,`date`);--> statement-breakpoint
CREATE INDEX `practice_plan_submission_review_date` ON `practice_plan_submissions` (`status`,`date`);