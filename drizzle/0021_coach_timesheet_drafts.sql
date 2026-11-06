ALTER TABLE `coach_time_entries` ADD `draft_seconds` integer;--> statement-breakpoint
ALTER TABLE `coach_time_entries` ADD `draft_duty` text;--> statement-breakpoint
ALTER TABLE `coach_time_entries` ADD `draft_note` text;--> statement-breakpoint
ALTER TABLE `coach_time_entries` ADD `submitted_at` text;
--> statement-breakpoint
UPDATE coach_time_entries SET submitted_at=COALESCE(approved_at,closed_at)
 WHERE closed_at IS NOT NULL AND voided_at IS NULL;
