ALTER TABLE `coach_openings` ADD `format` text;--> statement-breakpoint
ALTER TABLE `coach_openings` ADD `capacity` integer;--> statement-breakpoint
ALTER TABLE `coach_openings` ADD `closed` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `coach_openings` ADD `invite_code` text;--> statement-breakpoint
ALTER TABLE `coach_openings` ADD `organizer_id` text;--> statement-breakpoint
ALTER TABLE `coach_openings` ADD `organizer_wrestlers` text;--> statement-breakpoint
CREATE UNIQUE INDEX `coach_openings_invite` ON `coach_openings` (`invite_code`);