CREATE TABLE `coach_profiles` (
	`email` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`payload` text NOT NULL,
	`revision` integer NOT NULL,
	`photo_key` text,
	`photo_type` text,
	`updated_at` text NOT NULL
);
