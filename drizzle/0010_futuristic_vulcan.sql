CREATE TABLE `integration_secrets` (
	`id` text PRIMARY KEY NOT NULL,
	`encrypted` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL
);
