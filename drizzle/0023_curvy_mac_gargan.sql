CREATE TABLE `announcement_recipients` (
	`announcement_id` text NOT NULL,
	`user_id` text NOT NULL,
	`email` text NOT NULL,
	`read_at` text,
	`email_status` text NOT NULL,
	PRIMARY KEY(`announcement_id`, `user_id`)
);
--> statement-breakpoint
CREATE INDEX `announcement_recipients_user` ON `announcement_recipients` (`user_id`);--> statement-breakpoint
CREATE TABLE `announcements` (
	`id` text PRIMARY KEY NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`audience` text NOT NULL,
	`audience_label` text NOT NULL,
	`sent_by` text NOT NULL,
	`sent_at` text NOT NULL,
	`recipients` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `announcements_sent` ON `announcements` (`sent_at`);--> statement-breakpoint
CREATE TABLE `family_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`sender_role` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	`read_at` text,
	`email_status` text NOT NULL,
	CONSTRAINT "family_message_sender" CHECK("family_messages"."sender_role" IN ('owner','family'))
);
--> statement-breakpoint
CREATE INDEX `family_messages_thread` ON `family_messages` (`user_id`,`created_at`);