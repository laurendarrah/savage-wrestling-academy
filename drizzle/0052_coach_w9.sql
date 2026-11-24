CREATE TABLE `coach_w9` (
	`email` text PRIMARY KEY NOT NULL,
	`received_on` text NOT NULL,
	`recorded_at` text NOT NULL,
	`recorded_by` text NOT NULL,
	CONSTRAINT "coach_w9_date" CHECK("coach_w9"."received_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);
