CREATE TABLE `program_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`wrestler_id` text NOT NULL,
	`program` text NOT NULL,
	`wrestler_name` text NOT NULL,
	`grade` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`decided_by` text,
	CONSTRAINT "approval_status" CHECK("program_approvals"."status" IN ('pending','approved','declined'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `approval_family_wrestler_program` ON `program_approvals` (`user_id`,`wrestler_id`,`program`);