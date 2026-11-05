CREATE TABLE `restore_guard` (
	`id` text PRIMARY KEY NOT NULL,
	`valid` integer NOT NULL,
	CONSTRAINT "valid_restore" CHECK("restore_guard"."valid" = 1)
);
