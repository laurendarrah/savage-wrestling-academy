CREATE TABLE `removed_coaches` (
	`id` text PRIMARY KEY NOT NULL,
	`email_hash` text NOT NULL,
	`email` text,
	`name` text,
	`removed_on` text NOT NULL,
	`cleaned_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `removed_coaches_email` ON `removed_coaches` (`email_hash`);