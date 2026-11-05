CREATE TABLE `practice_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`program` text NOT NULL,
	`date` text NOT NULL,
	`payload` text NOT NULL,
	`published` integer NOT NULL,
	`revision` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "practice_plan_published" CHECK("practice_plans"."published" IN (0,1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `practice_plan_program_date` ON `practice_plans` (`program`,`date`);