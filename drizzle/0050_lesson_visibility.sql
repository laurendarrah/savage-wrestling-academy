ALTER TABLE `coach_openings` ADD `hidden` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `coach_openings` ADD `share_code` text;--> statement-breakpoint
CREATE UNIQUE INDEX `coach_openings_share` ON `coach_openings` (`share_code`);