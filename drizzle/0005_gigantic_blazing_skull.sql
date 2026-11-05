CREATE TABLE `approval_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`approval_id` text NOT NULL,
	`sender_id` text NOT NULL,
	`sender_role` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "approval_sender_role" CHECK("approval_messages"."sender_role" IN ('owner','parent'))
);
