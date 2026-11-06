CREATE TABLE `coach_time_off` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`coach_name` text NOT NULL,
	`category` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`submitted_at` text NOT NULL,
	`reviewed_at` text,
	`reviewed_by` text,
	`revision` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "coach_time_off_category" CHECK("coach_time_off"."category" IN ('sick','personal','vacation','other')),
	CONSTRAINT "coach_time_off_status" CHECK("coach_time_off"."status" IN ('pending','approved','declined','withdrawn','cancelled')),
	CONSTRAINT "coach_time_off_range" CHECK("coach_time_off"."start_date" <= "coach_time_off"."end_date")
);
--> statement-breakpoint
CREATE INDEX `coach_time_off_person` ON `coach_time_off` (`user_id`,`submitted_at`,`id`);--> statement-breakpoint
CREATE INDEX `coach_time_off_queue` ON `coach_time_off` (`status`,`submitted_at`,`id`);