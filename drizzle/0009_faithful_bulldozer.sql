CREATE TABLE `practice_curriculum_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`program` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`revision` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `curriculum_program_name` ON `practice_curriculum_groups` (`program`,`name_key`);--> statement-breakpoint
DROP INDEX `practice_curriculum_name`;--> statement-breakpoint
ALTER TABLE `practice_curricula` ADD `curriculum_id` text;--> statement-breakpoint
ALTER TABLE `practice_curricula` ADD `lesson_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `practice_curriculum_lesson_name` ON `practice_curricula` (`curriculum_id`,`name_key`);